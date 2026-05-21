// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {AgentHubConfig} from "../src/AgentHubConfig.sol";
import {AgentHubRegistry} from "../src/AgentHubRegistry.sol";
import {AgentHubEscrow} from "../src/AgentHubEscrow.sol";
import {IAgentHubRegistry} from "../src/interfaces/IAgentHubRegistry.sol";

contract MockUSDC {
    string private constant NAME = "USD Coin";
    string private constant SYMBOL = "USDC";
    uint8 private constant DECIMALS = 6;

    mapping(address account => uint256 balance) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 allowance)) public allowance;

    function name() external pure returns (string memory) {
        return NAME;
    }

    function symbol() external pure returns (string memory) {
        return SYMBOL;
    }

    function decimals() external pure returns (uint8) {
        return DECIMALS;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 approved = allowance[from][msg.sender];
        if (approved != type(uint256).max) allowance[from][msg.sender] = approved - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract AgentHubTest is Test {
    uint64 private constant QUEUE_TIMEOUT = 1 hours;
    uint64 private constant WORK_TIMEOUT = 2 days;
    uint64 private constant REVIEW_TIMEOUT = 12 hours;
    uint64 private constant REFUND_GRACE_PERIOD = 1 days;

    uint256 private constant USER_PK = 0xA11CE;
    uint256 private constant PROVIDER_OWNER_PK = 0xB0B;
    uint256 private constant PROVIDER_SIGNER_PK = 0x51A7E;
    uint256 private constant ATTESTER_PK = 0xA77E57;
    uint256 private constant NEW_ATTESTER_PK = 0xA77E58;
    bytes32 private constant REQUEST_ID = keccak256("request-id");

    address private user = vm.addr(USER_PK);
    address private providerOwner = vm.addr(PROVIDER_OWNER_PK);
    address private providerSigner = vm.addr(PROVIDER_SIGNER_PK);
    address private attester = vm.addr(ATTESTER_PK);
    address private newAttester = vm.addr(NEW_ATTESTER_PK);
    address private providerPayout = address(0xCAFE);
    address private treasury = address(0xFEE);

    MockUSDC private usdc;
    AgentHubConfig private config;
    AgentHubRegistry private registry;
    AgentHubEscrow private escrow;

    uint256 private providerId;

    function setUp() public {
        usdc = new MockUSDC();
        config = new AgentHubConfig(
            address(this), address(usdc), treasury, 250, attester, REVIEW_TIMEOUT, REFUND_GRACE_PERIOD
        );
        registry = new AgentHubRegistry(address(config));
        escrow = new AgentHubEscrow(address(config), address(registry));

        vm.startPrank(providerOwner);
        providerId = _registerProvider();
        vm.stopPrank();

        usdc.mint(user, 10_000e6);
        vm.prank(user);
        usdc.approve(address(escrow), type(uint256).max);
    }

    function test_CreateJobPullsFundsAndOnlyStartsQueueDeadline() public {
        uint256 createdAt = block.timestamp;
        uint256 jobId = _createJob();

        AgentHubEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(uint8(job.status), uint8(AgentHubEscrow.JobStatus.FUNDED));
        assertEq(job.user, user);
        assertEq(job.providerId, providerId);
        assertEq(job.price, 1_000e6);
        assertEq(job.protocolFee, 25e6);
        assertEq(job.providerPayoutWallet, providerPayout);
        assertEq(job.treasury, treasury);
        assertEq(job.deliveryAttester, attester);
        assertEq(job.queueDeadline, createdAt + QUEUE_TIMEOUT);
        assertEq(job.startedAt, 0);
        assertEq(job.workTimeout, WORK_TIMEOUT);
        assertEq(job.workDeadline, 0);
        assertEq(job.reviewTimeout, REVIEW_TIMEOUT);
        assertEq(job.finalRefundDeadline, 0);
        assertEq(job.deliveredAt, 0);
        assertEq(job.settledAt, 0);
        assertEq(job.refundedAt, 0);
        assertEq(job.requestId, REQUEST_ID);
        assertEq(job.inputCommitment, keccak256("input"));
        assertEq(job.outputCommitment, bytes32(0));
        assertEq(usdc.balanceOf(user), 9_000e6);
        assertEq(usdc.balanceOf(address(escrow)), 1_000e6);
    }

    function test_StartJobStartsExecutionDeadlines() public {
        uint256 jobId = _createJob();
        uint256 startedAt = block.timestamp;

        _startJob(jobId, block.timestamp + 1 hours);

        AgentHubEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(uint8(job.status), uint8(AgentHubEscrow.JobStatus.RUNNING));
        assertEq(job.startedAt, startedAt);
        assertEq(job.workDeadline, startedAt + WORK_TIMEOUT);
        assertEq(job.finalRefundDeadline, startedAt + WORK_TIMEOUT + REVIEW_TIMEOUT + REFUND_GRACE_PERIOD);
    }

    function test_StartJobRevertsAfterQueueDeadline() public {
        uint256 jobId = _createJob();
        AgentHubEscrow.Job memory job = escrow.getJob(jobId);
        uint256 expiresAt = job.queueDeadline + 1 hours;
        bytes memory signature = _signStartJob(PROVIDER_SIGNER_PK, jobId, expiresAt);

        vm.warp(job.queueDeadline + 1);
        vm.expectRevert(AgentHubEscrow.QueueDeadlineExceeded.selector);
        escrow.startJob(jobId, expiresAt, signature);
    }

    function test_StartJobRevertsWithWrongSignature() public {
        uint256 jobId = _createJob();
        uint256 expiresAt = block.timestamp + 1 hours;
        bytes memory signature = _signStartJob(ATTESTER_PK, jobId, expiresAt);

        vm.expectRevert(AgentHubEscrow.InvalidSignature.selector);
        escrow.startJob(jobId, expiresAt, signature);
    }

    function test_StartJobReplayRevertsWhenJobIsNoLongerQueued() public {
        uint256 jobId = _createJob();
        uint256 expiresAt = block.timestamp + 1 hours;
        bytes memory signature = _signStartJob(PROVIDER_SIGNER_PK, jobId, expiresAt);

        escrow.startJob(jobId, expiresAt, signature);

        vm.expectRevert(AgentHubEscrow.JobNotQueued.selector);
        escrow.startJob(jobId, expiresAt, signature);
    }

    function test_StartJobRevertsWhenProviderWasDisabledAfterFunding() public {
        uint256 jobId = _createJob();
        uint256 expiresAt = block.timestamp + 1 hours;
        bytes memory signature = _signStartJob(PROVIDER_SIGNER_PK, jobId, expiresAt);

        registry.setProviderStatus(providerId, IAgentHubRegistry.ProviderStatus.DISABLED);

        vm.expectRevert(AgentHubEscrow.ProviderNotActive.selector);
        escrow.startJob(jobId, expiresAt, signature);
    }

    function test_SettlementIsImpossibleBeforeStartJob() public {
        uint256 jobId = _createJob();
        bytes32 outputCommitment = keccak256("output");
        uint256 expiresAt = block.timestamp + 1 hours;
        bytes memory signature = _signUserAcceptance(jobId, outputCommitment, expiresAt);

        vm.expectRevert(AgentHubEscrow.JobNotRunning.selector);
        escrow.settleWithUserSignature(jobId, outputCommitment, expiresAt, signature);
    }

    function test_SettleWithUserSignaturePaysProviderAndTreasuryAfterStartJob() public {
        uint256 jobId = _createJob();
        _startJob(jobId, block.timestamp + 1 hours);

        bytes32 outputCommitment = keccak256("output");
        uint256 expiresAt = block.timestamp + 1 hours;
        bytes memory signature = _signUserAcceptance(jobId, outputCommitment, expiresAt);
        uint256 settledAt = block.timestamp;
        escrow.settleWithUserSignature(jobId, outputCommitment, expiresAt, signature);

        AgentHubEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(uint8(job.status), uint8(AgentHubEscrow.JobStatus.SETTLED));
        assertEq(job.outputCommitment, outputCommitment);
        assertEq(job.deliveredAt, 0);
        assertEq(job.settledAt, settledAt);
        assertEq(usdc.balanceOf(providerPayout), 975e6);
        assertEq(usdc.balanceOf(treasury), 25e6);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_SettleWithUserSignatureRevertsWhenExpired() public {
        uint256 jobId = _createJob();
        _startJob(jobId, block.timestamp + 1 hours);

        bytes32 outputCommitment = keccak256("output");
        uint256 expiresAt = block.timestamp + 1 hours;
        bytes memory signature = _signUserAcceptance(jobId, outputCommitment, expiresAt);

        vm.warp(expiresAt + 1);
        vm.expectRevert(AgentHubEscrow.AuthorizationExpired.selector);
        escrow.settleWithUserSignature(jobId, outputCommitment, expiresAt, signature);
    }

    function test_SettleWithUserSignatureReplayRevertsWhenJobIsNoLongerRunning() public {
        uint256 jobId = _createJob();
        _startJob(jobId, block.timestamp + 1 hours);

        bytes32 outputCommitment = keccak256("output");
        uint256 expiresAt = block.timestamp + 1 hours;
        bytes memory signature = _signUserAcceptance(jobId, outputCommitment, expiresAt);

        escrow.settleWithUserSignature(jobId, outputCommitment, expiresAt, signature);

        vm.expectRevert(AgentHubEscrow.JobNotRunning.selector);
        escrow.settleWithUserSignature(jobId, outputCommitment, expiresAt, signature);
    }

    function test_SettleAfterReviewTimeoutWithDeliveryAttestationAfterStartJob() public {
        uint256 jobId = _createJob();
        _startJob(jobId, block.timestamp + 1 hours);

        AgentHubEscrow.Job memory runningJob = escrow.getJob(jobId);
        bytes32 outputCommitment = keccak256("output");
        uint64 deliveredAt = runningJob.workDeadline;
        uint256 expiresAt = uint256(deliveredAt) + runningJob.reviewTimeout + 1 hours;
        bytes memory signature = _signDeliveryAttestation(jobId, outputCommitment, deliveredAt, expiresAt);

        vm.warp(uint256(deliveredAt) + runningJob.reviewTimeout + 1);
        uint256 settledAt = block.timestamp;
        escrow.settleAfterReviewTimeout(jobId, outputCommitment, deliveredAt, expiresAt, signature);

        AgentHubEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(uint8(job.status), uint8(AgentHubEscrow.JobStatus.SETTLED));
        assertEq(job.outputCommitment, outputCommitment);
        assertEq(job.deliveredAt, deliveredAt);
        assertEq(job.settledAt, settledAt);
        assertEq(usdc.balanceOf(providerPayout), 975e6);
        assertEq(usdc.balanceOf(treasury), 25e6);
    }

    function test_SettleAfterReviewTimeoutRevertsWhenDeliveredBeforeStart() public {
        uint256 jobId = _createJob();
        _startJob(jobId, block.timestamp + 1 hours);

        AgentHubEscrow.Job memory runningJob = escrow.getJob(jobId);
        bytes32 outputCommitment = keccak256("output");
        uint256 deliveredAt = uint256(runningJob.startedAt) - 1;
        uint256 expiresAt = block.timestamp + 1 hours;
        bytes memory signature = _signDeliveryAttestation(jobId, outputCommitment, deliveredAt, expiresAt);

        vm.expectRevert(AgentHubEscrow.DeliveredBeforeStart.selector);
        escrow.settleAfterReviewTimeout(jobId, outputCommitment, deliveredAt, expiresAt, signature);
    }

    function test_SettleAfterReviewTimeoutRevertsWhenDeliveredAfterWorkDeadline() public {
        uint256 jobId = _createJob();
        _startJob(jobId, block.timestamp + 1 hours);

        AgentHubEscrow.Job memory runningJob = escrow.getJob(jobId);
        bytes32 outputCommitment = keccak256("output");
        uint256 deliveredAt = uint256(runningJob.workDeadline) + 1;
        uint256 expiresAt = deliveredAt + runningJob.reviewTimeout + 1 hours;
        bytes memory signature = _signDeliveryAttestation(jobId, outputCommitment, deliveredAt, expiresAt);

        vm.warp(deliveredAt + runningJob.reviewTimeout + 1);
        vm.expectRevert(AgentHubEscrow.WorkDeadlineExceeded.selector);
        escrow.settleAfterReviewTimeout(jobId, outputCommitment, deliveredAt, expiresAt, signature);
    }

    function test_SettleAfterReviewTimeoutRevertsWhenDeliveredInFuture() public {
        uint256 jobId = _createJob();
        _startJob(jobId, block.timestamp + 1 hours);

        AgentHubEscrow.Job memory runningJob = escrow.getJob(jobId);
        bytes32 outputCommitment = keccak256("output");
        uint256 deliveredAt = runningJob.workDeadline;
        uint256 expiresAt = deliveredAt + runningJob.reviewTimeout + 1 hours;
        bytes memory signature = _signDeliveryAttestation(jobId, outputCommitment, deliveredAt, expiresAt);

        vm.expectRevert(AgentHubEscrow.FutureDeliveredAt.selector);
        escrow.settleAfterReviewTimeout(jobId, outputCommitment, deliveredAt, expiresAt, signature);
    }

    function test_SettleAfterReviewTimeoutUsesSnapshottedDeliveryAttester() public {
        uint256 jobId = _createJob();
        config.setDeliveryAttester(newAttester);
        _startJob(jobId, block.timestamp + 1 hours);

        AgentHubEscrow.Job memory runningJob = escrow.getJob(jobId);
        bytes32 outputCommitment = keccak256("output");
        uint256 deliveredAt = runningJob.workDeadline;
        uint256 expiresAt = deliveredAt + runningJob.reviewTimeout + 1 hours;
        bytes memory snapshotSignature =
            _signDeliveryAttestationWithKey(ATTESTER_PK, jobId, outputCommitment, deliveredAt, expiresAt);

        vm.warp(deliveredAt + runningJob.reviewTimeout + 1);
        escrow.settleAfterReviewTimeout(jobId, outputCommitment, deliveredAt, expiresAt, snapshotSignature);

        assertEq(uint8(escrow.getJob(jobId).status), uint8(AgentHubEscrow.JobStatus.SETTLED));
    }

    function test_SettleAfterReviewTimeoutRejectsNewDeliveryAttesterForOldJob() public {
        uint256 jobId = _createJob();
        config.setDeliveryAttester(newAttester);
        _startJob(jobId, block.timestamp + 1 hours);

        AgentHubEscrow.Job memory runningJob = escrow.getJob(jobId);
        bytes32 outputCommitment = keccak256("output");
        uint256 deliveredAt = runningJob.workDeadline;
        uint256 expiresAt = deliveredAt + runningJob.reviewTimeout + 1 hours;
        bytes memory newAttesterSignature =
            _signDeliveryAttestationWithKey(NEW_ATTESTER_PK, jobId, outputCommitment, deliveredAt, expiresAt);

        vm.warp(deliveredAt + runningJob.reviewTimeout + 1);
        vm.expectRevert(AgentHubEscrow.InvalidSignature.selector);
        escrow.settleAfterReviewTimeout(jobId, outputCommitment, deliveredAt, expiresAt, newAttesterSignature);
    }

    function test_SettleAfterReviewTimeoutReplayRevertsWhenJobIsNoLongerRunning() public {
        uint256 jobId = _createJob();
        _startJob(jobId, block.timestamp + 1 hours);

        AgentHubEscrow.Job memory runningJob = escrow.getJob(jobId);
        bytes32 outputCommitment = keccak256("output");
        uint64 deliveredAt = runningJob.workDeadline;
        uint256 expiresAt = uint256(deliveredAt) + runningJob.reviewTimeout + 1 hours;
        bytes memory signature = _signDeliveryAttestation(jobId, outputCommitment, deliveredAt, expiresAt);

        vm.warp(uint256(deliveredAt) + runningJob.reviewTimeout + 1);
        escrow.settleAfterReviewTimeout(jobId, outputCommitment, deliveredAt, expiresAt, signature);

        vm.expectRevert(AgentHubEscrow.JobNotRunning.selector);
        escrow.settleAfterReviewTimeout(jobId, outputCommitment, deliveredAt, expiresAt, signature);
    }

    function test_RefundWithNoDeliveryAttestationAfterStartJob() public {
        uint256 jobId = _createJob();
        _startJob(jobId, block.timestamp + 1 hours);

        AgentHubEscrow.Job memory runningJob = escrow.getJob(jobId);
        uint64 checkedAt = runningJob.workDeadline + 1;
        uint256 expiresAt = uint256(checkedAt) + 1 hours;
        bytes memory signature = _signNoDeliveryAttestation(jobId, checkedAt, expiresAt);

        vm.warp(checkedAt);
        uint256 refundedAt = block.timestamp;
        escrow.refundWithNoDeliveryAttestation(jobId, checkedAt, expiresAt, signature);

        AgentHubEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(uint8(job.status), uint8(AgentHubEscrow.JobStatus.REFUNDED));
        assertEq(job.refundedAt, refundedAt);
        assertEq(usdc.balanceOf(user), 10_000e6);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_RefundWithNoDeliveryAttestationReplayRevertsWhenJobIsNoLongerRunning() public {
        uint256 jobId = _createJob();
        _startJob(jobId, block.timestamp + 1 hours);

        AgentHubEscrow.Job memory runningJob = escrow.getJob(jobId);
        uint64 checkedAt = runningJob.workDeadline + 1;
        uint256 expiresAt = uint256(checkedAt) + 1 hours;
        bytes memory signature = _signNoDeliveryAttestation(jobId, checkedAt, expiresAt);

        vm.warp(checkedAt);
        escrow.refundWithNoDeliveryAttestation(jobId, checkedAt, expiresAt, signature);

        vm.expectRevert(AgentHubEscrow.JobNotRunning.selector);
        escrow.refundWithNoDeliveryAttestation(jobId, checkedAt, expiresAt, signature);
    }

    function test_RefundWithNoDeliveryAttestationUsesSnapshottedDeliveryAttester() public {
        uint256 jobId = _createJob();
        config.setDeliveryAttester(newAttester);
        _startJob(jobId, block.timestamp + 1 hours);

        AgentHubEscrow.Job memory runningJob = escrow.getJob(jobId);
        uint256 checkedAt = uint256(runningJob.workDeadline) + 1;
        uint256 expiresAt = checkedAt + 1 hours;
        bytes memory snapshotSignature = _signNoDeliveryAttestationWithKey(ATTESTER_PK, jobId, checkedAt, expiresAt);

        vm.warp(checkedAt);
        escrow.refundWithNoDeliveryAttestation(jobId, checkedAt, expiresAt, snapshotSignature);

        AgentHubEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(uint8(job.status), uint8(AgentHubEscrow.JobStatus.REFUNDED));
        assertEq(job.refundedAt, checkedAt);
    }

    function test_RefundWithNoDeliveryAttestationRejectsNewDeliveryAttesterForOldJob() public {
        uint256 jobId = _createJob();
        config.setDeliveryAttester(newAttester);
        _startJob(jobId, block.timestamp + 1 hours);

        AgentHubEscrow.Job memory runningJob = escrow.getJob(jobId);
        uint256 checkedAt = uint256(runningJob.workDeadline) + 1;
        uint256 expiresAt = checkedAt + 1 hours;
        bytes memory newAttesterSignature =
            _signNoDeliveryAttestationWithKey(NEW_ATTESTER_PK, jobId, checkedAt, expiresAt);

        vm.warp(checkedAt);
        vm.expectRevert(AgentHubEscrow.InvalidSignature.selector);
        escrow.refundWithNoDeliveryAttestation(jobId, checkedAt, expiresAt, newAttesterSignature);
    }

    function test_TwoJobsCanStartAndSettleInAnyOrder() public {
        uint256 firstJobId = _createJob();
        uint256 secondJobId = _createJob();
        uint256 expiresAt = block.timestamp + 1 hours;

        escrow.startJob(secondJobId, expiresAt, _signStartJob(PROVIDER_SIGNER_PK, secondJobId, expiresAt));
        escrow.startJob(firstJobId, expiresAt, _signStartJob(PROVIDER_SIGNER_PK, firstJobId, expiresAt));

        bytes32 firstOutputCommitment = keccak256("first output");
        bytes32 secondOutputCommitment = keccak256("second output");
        escrow.settleWithUserSignature(
            firstJobId,
            firstOutputCommitment,
            expiresAt,
            _signUserAcceptance(firstJobId, firstOutputCommitment, expiresAt)
        );
        escrow.settleWithUserSignature(
            secondJobId,
            secondOutputCommitment,
            expiresAt,
            _signUserAcceptance(secondJobId, secondOutputCommitment, expiresAt)
        );

        assertEq(uint8(escrow.getJob(firstJobId).status), uint8(AgentHubEscrow.JobStatus.SETTLED));
        assertEq(uint8(escrow.getJob(secondJobId).status), uint8(AgentHubEscrow.JobStatus.SETTLED));
        assertEq(usdc.balanceOf(providerPayout), 1_950e6);
        assertEq(usdc.balanceOf(treasury), 50e6);
    }

    function test_TwoJobsCanRefundInAnyOrder() public {
        uint256 firstJobId = _createJob();
        uint256 secondJobId = _createJob();
        uint256 startExpiresAt = block.timestamp + 1 hours;

        escrow.startJob(secondJobId, startExpiresAt, _signStartJob(PROVIDER_SIGNER_PK, secondJobId, startExpiresAt));
        escrow.startJob(firstJobId, startExpiresAt, _signStartJob(PROVIDER_SIGNER_PK, firstJobId, startExpiresAt));

        AgentHubEscrow.Job memory firstJob = escrow.getJob(firstJobId);
        AgentHubEscrow.Job memory secondJob = escrow.getJob(secondJobId);
        uint64 firstCheckedAt = firstJob.workDeadline + 1;
        uint64 secondCheckedAt = secondJob.workDeadline + 1;
        uint256 firstExpiresAt = uint256(firstCheckedAt) + 1 hours;
        uint256 secondExpiresAt = uint256(secondCheckedAt) + 1 hours;

        vm.warp(secondCheckedAt);
        escrow.refundWithNoDeliveryAttestation(
            secondJobId,
            secondCheckedAt,
            secondExpiresAt,
            _signNoDeliveryAttestation(secondJobId, secondCheckedAt, secondExpiresAt)
        );
        escrow.refundWithNoDeliveryAttestation(
            firstJobId,
            firstCheckedAt,
            firstExpiresAt,
            _signNoDeliveryAttestation(firstJobId, firstCheckedAt, firstExpiresAt)
        );

        assertEq(uint8(escrow.getJob(firstJobId).status), uint8(AgentHubEscrow.JobStatus.REFUNDED));
        assertEq(uint8(escrow.getJob(secondJobId).status), uint8(AgentHubEscrow.JobStatus.REFUNDED));
        assertEq(usdc.balanceOf(user), 10_000e6);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_RefundAfterQueueTimeoutWorksBeforeRunning() public {
        uint256 jobId = _createJob();
        AgentHubEscrow.Job memory createdJob = escrow.getJob(jobId);

        vm.warp(createdJob.queueDeadline + 1);
        uint256 refundedAt = block.timestamp;
        escrow.refundAfterQueueTimeout(jobId);

        AgentHubEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(uint8(job.status), uint8(AgentHubEscrow.JobStatus.REFUNDED));
        assertEq(job.workDeadline, 0);
        assertEq(job.finalRefundDeadline, 0);
        assertEq(job.refundedAt, refundedAt);
        assertEq(usdc.balanceOf(user), 10_000e6);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_RefundAfterFinalTimeoutOnlyWorksAfterRunning() public {
        uint256 jobId = _createJob();

        vm.expectRevert(AgentHubEscrow.JobNotRunning.selector);
        escrow.refundAfterFinalTimeout(jobId);

        _startJob(jobId, block.timestamp + 1 hours);
        AgentHubEscrow.Job memory runningJob = escrow.getJob(jobId);

        vm.warp(runningJob.finalRefundDeadline + 1);
        uint256 refundedAt = block.timestamp;
        escrow.refundAfterFinalTimeout(jobId);

        AgentHubEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(uint8(job.status), uint8(AgentHubEscrow.JobStatus.REFUNDED));
        assertEq(job.refundedAt, refundedAt);
        assertEq(usdc.balanceOf(user), 10_000e6);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_RegisterProviderRevertsWhenAuthorizationExpired() public {
        uint256 expiresAt = block.timestamp + 1 hours;
        bytes memory signature = _signRegisterProvider(
            ATTESTER_PK,
            providerOwner,
            providerSigner,
            providerPayout,
            1_000e6,
            WORK_TIMEOUT,
            keccak256("provider metadata"),
            expiresAt
        );

        vm.warp(expiresAt + 1);
        vm.prank(providerOwner);
        vm.expectRevert(AgentHubRegistry.AuthorizationExpired.selector);
        registry.registerProvider(
            providerSigner, providerPayout, 1_000e6, WORK_TIMEOUT, keccak256("provider metadata"), expiresAt, signature
        );
    }

    function test_RegisterProviderRevertsWithWrongAttesterSignature() public {
        uint256 expiresAt = block.timestamp + 1 hours;
        bytes memory signature = _signRegisterProvider(
            PROVIDER_OWNER_PK,
            providerOwner,
            providerSigner,
            providerPayout,
            1_000e6,
            WORK_TIMEOUT,
            keccak256("provider metadata"),
            expiresAt
        );

        vm.prank(providerOwner);
        vm.expectRevert(AgentHubRegistry.InvalidSignature.selector);
        registry.registerProvider(
            providerSigner, providerPayout, 1_000e6, WORK_TIMEOUT, keccak256("provider metadata"), expiresAt, signature
        );
    }

    function test_RegisterProviderRevertsWhenSignedForAnotherOwner() public {
        address otherOwner = address(0xBAD);
        uint256 expiresAt = block.timestamp + 1 hours;
        bytes memory signature = _signRegisterProvider(
            ATTESTER_PK,
            otherOwner,
            providerSigner,
            providerPayout,
            1_000e6,
            WORK_TIMEOUT,
            keccak256("provider metadata"),
            expiresAt
        );

        vm.prank(providerOwner);
        vm.expectRevert(AgentHubRegistry.InvalidSignature.selector);
        registry.registerProvider(
            providerSigner, providerPayout, 1_000e6, WORK_TIMEOUT, keccak256("provider metadata"), expiresAt, signature
        );
    }

    function test_RegisterProviderStoresDedicatedProviderSigner() public view {
        IAgentHubRegistry.Provider memory provider = registry.getProvider(providerId);

        assertEq(provider.signer, providerSigner);
        assertTrue(provider.signer != attester);
    }

    function test_CreateJobRevertsWhenQueueTimeoutIsBelowOneMinute() public {
        uint256 expiresAt = block.timestamp + 1 hours;
        bytes memory signature = _signCreateJob(ATTESTER_PK, user, REQUEST_ID, keccak256("input"), expiresAt);

        vm.prank(user);
        vm.expectRevert(AgentHubEscrow.QueueTimeoutTooShort.selector);
        escrow.createJob(providerId, REQUEST_ID, keccak256("input"), 1 minutes - 1, expiresAt, signature);
    }

    function test_CreateJobRevertsWhenAuthorizationExpired() public {
        uint256 expiresAt = block.timestamp + 1 hours;
        bytes memory signature = _signCreateJob(ATTESTER_PK, user, REQUEST_ID, keccak256("input"), expiresAt);

        vm.warp(expiresAt + 1);
        vm.prank(user);
        vm.expectRevert(AgentHubEscrow.AuthorizationExpired.selector);
        escrow.createJob(providerId, REQUEST_ID, keccak256("input"), QUEUE_TIMEOUT, expiresAt, signature);
    }

    function test_CreateJobRevertsWithWrongAttesterSignature() public {
        uint256 expiresAt = block.timestamp + 1 hours;
        bytes memory signature = _signCreateJob(PROVIDER_OWNER_PK, user, REQUEST_ID, keccak256("input"), expiresAt);

        vm.prank(user);
        vm.expectRevert(AgentHubEscrow.InvalidSignature.selector);
        escrow.createJob(providerId, REQUEST_ID, keccak256("input"), QUEUE_TIMEOUT, expiresAt, signature);
    }

    function test_CreateJobRevertsWhenSignedForAnotherUser() public {
        address otherUser = address(0xBAD);
        uint256 expiresAt = block.timestamp + 1 hours;
        bytes memory signature = _signCreateJob(ATTESTER_PK, otherUser, REQUEST_ID, keccak256("input"), expiresAt);

        vm.prank(user);
        vm.expectRevert(AgentHubEscrow.InvalidSignature.selector);
        escrow.createJob(providerId, REQUEST_ID, keccak256("input"), QUEUE_TIMEOUT, expiresAt, signature);
    }

    function test_CreateJobRevertsWhenRequestIdWasAlreadyUsed() public {
        _createJob();

        bytes32 otherInputCommitment = keccak256("other input");
        uint256 expiresAt = block.timestamp + 1 hours;
        bytes memory signature = _signCreateJob(ATTESTER_PK, user, REQUEST_ID, otherInputCommitment, expiresAt);

        vm.prank(user);
        vm.expectRevert(AgentHubEscrow.RequestAlreadyUsed.selector);
        escrow.createJob(providerId, REQUEST_ID, otherInputCommitment, QUEUE_TIMEOUT, expiresAt, signature);
    }

    function test_CreateJobRevertsWhenProviderPriceChangedAfterAuthorization() public {
        uint256 expiresAt = block.timestamp + 1 hours;
        bytes memory signature = _signCreateJob(ATTESTER_PK, user, REQUEST_ID, keccak256("input"), expiresAt);

        vm.prank(providerOwner);
        registry.updateProviderPrice(providerId, 2_000e6);

        vm.prank(user);
        vm.expectRevert(AgentHubEscrow.InvalidSignature.selector);
        escrow.createJob(providerId, REQUEST_ID, keccak256("input"), QUEUE_TIMEOUT, expiresAt, signature);
    }

    function test_CreateJobRevertsWhenQueueTimeoutDiffersFromAuthorization() public {
        uint256 expiresAt = block.timestamp + 1 hours;
        bytes memory signature = _signCreateJob(ATTESTER_PK, user, REQUEST_ID, keccak256("input"), expiresAt);

        vm.prank(user);
        vm.expectRevert(AgentHubEscrow.InvalidSignature.selector);
        escrow.createJob(providerId, REQUEST_ID, keccak256("input"), QUEUE_TIMEOUT + 1 hours, expiresAt, signature);
    }

    function _registerProvider() private returns (uint256) {
        bytes32 metadataCommitment = keccak256("provider metadata");
        uint256 expiresAt = block.timestamp + 1 hours;
        bytes memory signature = _signRegisterProvider(
            ATTESTER_PK,
            providerOwner,
            providerSigner,
            providerPayout,
            1_000e6,
            WORK_TIMEOUT,
            metadataCommitment,
            expiresAt
        );

        return registry.registerProvider(
            providerSigner, providerPayout, 1_000e6, WORK_TIMEOUT, metadataCommitment, expiresAt, signature
        );
    }

    function _createJob() private returns (uint256) {
        bytes32 requestId =
            escrow.nextJobId() == 1 ? REQUEST_ID : keccak256(abi.encode("request-id", escrow.nextJobId()));
        uint256 expiresAt = block.timestamp + 1 hours;
        bytes memory signature = _signCreateJob(ATTESTER_PK, user, requestId, keccak256("input"), expiresAt);

        vm.prank(user);
        return escrow.createJob(providerId, requestId, keccak256("input"), QUEUE_TIMEOUT, expiresAt, signature);
    }

    function _startJob(uint256 jobId, uint256 expiresAt) private {
        escrow.startJob(jobId, expiresAt, _signStartJob(PROVIDER_SIGNER_PK, jobId, expiresAt));
    }

    function _signStartJob(uint256 privateKey, uint256 jobId, uint256 expiresAt) private view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(escrow.START_JOB_AUTHORIZATION_TYPEHASH(), jobId, providerId, keccak256("input"), expiresAt)
        );
        return _sign(privateKey, _typedDataHash(structHash));
    }

    function _signRegisterProvider(
        uint256 privateKey,
        address owner,
        address signer,
        address payoutWallet,
        uint256 price,
        uint64 workTimeout,
        bytes32 metadataCommitment,
        uint256 expiresAt
    ) private view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                registry.REGISTER_PROVIDER_AUTHORIZATION_TYPEHASH(),
                owner,
                signer,
                payoutWallet,
                price,
                workTimeout,
                metadataCommitment,
                expiresAt
            )
        );
        return _sign(privateKey, _registryTypedDataHash(structHash));
    }

    function _signCreateJob(
        uint256 privateKey,
        address authorizedUser,
        bytes32 requestId,
        bytes32 inputCommitment,
        uint256 expiresAt
    ) private view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                escrow.CREATE_JOB_AUTHORIZATION_TYPEHASH(),
                authorizedUser,
                providerId,
                1_000e6,
                WORK_TIMEOUT,
                QUEUE_TIMEOUT,
                requestId,
                inputCommitment,
                expiresAt
            )
        );
        return _sign(privateKey, _typedDataHash(structHash));
    }

    function _signUserAcceptance(uint256 jobId, bytes32 outputCommitment, uint256 expiresAt)
        private
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                escrow.JOB_ACCEPTANCE_TYPEHASH(), jobId, providerId, keccak256("input"), outputCommitment, expiresAt
            )
        );
        return _sign(USER_PK, _typedDataHash(structHash));
    }

    function _signDeliveryAttestation(uint256 jobId, bytes32 outputCommitment, uint256 deliveredAt, uint256 expiresAt)
        private
        view
        returns (bytes memory)
    {
        return _signDeliveryAttestationWithKey(ATTESTER_PK, jobId, outputCommitment, deliveredAt, expiresAt);
    }

    function _signDeliveryAttestationWithKey(
        uint256 privateKey,
        uint256 jobId,
        bytes32 outputCommitment,
        uint256 deliveredAt,
        uint256 expiresAt
    ) private view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                escrow.DELIVERY_ATTESTATION_TYPEHASH(),
                jobId,
                providerId,
                keccak256("input"),
                outputCommitment,
                deliveredAt,
                expiresAt
            )
        );
        return _sign(privateKey, _typedDataHash(structHash));
    }

    function _signNoDeliveryAttestation(uint256 jobId, uint256 checkedAt, uint256 expiresAt)
        private
        view
        returns (bytes memory)
    {
        return _signNoDeliveryAttestationWithKey(ATTESTER_PK, jobId, checkedAt, expiresAt);
    }

    function _signNoDeliveryAttestationWithKey(uint256 privateKey, uint256 jobId, uint256 checkedAt, uint256 expiresAt)
        private
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                escrow.NO_DELIVERY_ATTESTATION_TYPEHASH(), jobId, providerId, keccak256("input"), checkedAt, expiresAt
            )
        );
        return _sign(privateKey, _typedDataHash(structHash));
    }

    function _typedDataHash(bytes32 structHash) private view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", escrow.domainSeparator(), structHash));
    }

    function _registryTypedDataHash(bytes32 structHash) private view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", registry.domainSeparator(), structHash));
    }

    function _sign(uint256 privateKey, bytes32 digest) private pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
