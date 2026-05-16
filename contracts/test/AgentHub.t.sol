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
    uint256 private constant PROVIDER_SIGNER_PK = 0x519;
    uint256 private constant ATTESTER_PK = 0xA77E57;
    bytes32 private constant REQUEST_ID = keccak256("request-id");

    address private user = vm.addr(USER_PK);
    address private providerOwner = vm.addr(PROVIDER_OWNER_PK);
    address private providerSigner = vm.addr(PROVIDER_SIGNER_PK);
    address private attester = vm.addr(ATTESTER_PK);
    address private providerPayout = address(0xCAFE);
    address private treasury = address(0xFEE);

    MockUSDC private usdc;
    AgentHubConfig private config;
    AgentHubRegistry private registry;
    AgentHubEscrow private escrow;

    uint256 private providerId;
    uint256 private serviceId;

    function setUp() public {
        usdc = new MockUSDC();
        config = new AgentHubConfig(
            address(this), address(usdc), treasury, 250, attester, REVIEW_TIMEOUT, REFUND_GRACE_PERIOD
        );
        registry = new AgentHubRegistry(address(config));
        escrow = new AgentHubEscrow(address(config), address(registry));

        vm.startPrank(providerOwner);
        providerId = registry.registerProvider(providerSigner, providerPayout, keccak256("provider metadata"));
        serviceId = registry.registerService(providerId, 1_000e6, WORK_TIMEOUT, keccak256("service metadata"));
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
        assertEq(job.serviceId, serviceId);
        assertEq(job.providerId, providerId);
        assertEq(job.price, 1_000e6);
        assertEq(job.protocolFee, 25e6);
        assertEq(job.providerPayoutWallet, providerPayout);
        assertEq(job.treasury, treasury);
        assertEq(job.queueDeadline, createdAt + QUEUE_TIMEOUT);
        assertEq(job.workTimeout, WORK_TIMEOUT);
        assertEq(job.workDeadline, 0);
        assertEq(job.reviewTimeout, REVIEW_TIMEOUT);
        assertEq(job.finalRefundDeadline, 0);
        assertEq(job.requestId, REQUEST_ID);
        assertEq(job.inputCommitment, keccak256("input"));
        assertEq(usdc.balanceOf(user), 9_000e6);
        assertEq(usdc.balanceOf(address(escrow)), 1_000e6);
    }

    function test_StartJobStartsExecutionDeadlines() public {
        uint256 jobId = _createJob();
        uint256 startedAt = block.timestamp;

        _startJob(jobId, block.timestamp + 1 hours, 0);

        AgentHubEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(uint8(job.status), uint8(AgentHubEscrow.JobStatus.RUNNING));
        assertEq(job.workDeadline, startedAt + WORK_TIMEOUT);
        assertEq(job.finalRefundDeadline, startedAt + WORK_TIMEOUT + REVIEW_TIMEOUT + REFUND_GRACE_PERIOD);
    }

    function test_StartJobRevertsAfterQueueDeadline() public {
        uint256 jobId = _createJob();
        AgentHubEscrow.Job memory job = escrow.getJob(jobId);
        uint256 expiresAt = job.queueDeadline + 1 hours;
        bytes memory signature = _signStartJob(PROVIDER_SIGNER_PK, jobId, expiresAt, 0);

        vm.warp(job.queueDeadline + 1);
        vm.expectRevert(AgentHubEscrow.QueueDeadlineExceeded.selector);
        escrow.startJob(jobId, expiresAt, 0, signature);
    }

    function test_StartJobRevertsWithWrongSignature() public {
        uint256 jobId = _createJob();
        uint256 expiresAt = block.timestamp + 1 hours;
        bytes memory signature = _signStartJob(PROVIDER_OWNER_PK, jobId, expiresAt, 0);

        vm.expectRevert(AgentHubEscrow.InvalidSignature.selector);
        escrow.startJob(jobId, expiresAt, 0, signature);
    }

    function test_StartJobRevertsWhenNonceIsNotNextNonce() public {
        uint256 firstJobId = _createJob();
        _startJob(firstJobId, block.timestamp + 1 hours, 0);

        uint256 secondJobId = _createJob();
        uint256 expiresAt = block.timestamp + 1 hours;
        bytes memory signature = _signStartJob(PROVIDER_SIGNER_PK, secondJobId, expiresAt, 0);

        vm.expectRevert(AgentHubEscrow.InvalidNonce.selector);
        escrow.startJob(secondJobId, expiresAt, 0, signature);
    }

    function test_StartJobRevertsWhenProviderWasDisabledAfterFunding() public {
        uint256 jobId = _createJob();
        uint256 expiresAt = block.timestamp + 1 hours;
        bytes memory signature = _signStartJob(PROVIDER_SIGNER_PK, jobId, expiresAt, 0);

        registry.setProviderStatus(providerId, IAgentHubRegistry.ProviderStatus.DISABLED);

        vm.expectRevert(AgentHubEscrow.ProviderNotActive.selector);
        escrow.startJob(jobId, expiresAt, 0, signature);
    }

    function test_StartJobStillWorksWhenServiceWasDisabledAfterFunding() public {
        uint256 jobId = _createJob();

        vm.prank(providerOwner);
        registry.setServiceStatus(serviceId, IAgentHubRegistry.ServiceStatus.DISABLED);

        _startJob(jobId, block.timestamp + 1 hours, 0);

        AgentHubEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(uint8(job.status), uint8(AgentHubEscrow.JobStatus.RUNNING));
    }

    function test_SettlementIsImpossibleBeforeStartJob() public {
        uint256 jobId = _createJob();
        bytes32 outputCommitment = keccak256("output");
        uint256 expiresAt = block.timestamp + 1 hours;
        bytes memory signature = _signUserAcceptance(jobId, outputCommitment, expiresAt, 0);

        vm.expectRevert(AgentHubEscrow.JobNotRunning.selector);
        escrow.settleWithUserSignature(jobId, outputCommitment, expiresAt, 0, signature);
    }

    function test_SettleWithUserSignaturePaysProviderAndTreasuryAfterStartJob() public {
        uint256 jobId = _createJob();
        _startJob(jobId, block.timestamp + 1 hours, 0);

        bytes32 outputCommitment = keccak256("output");
        uint256 expiresAt = block.timestamp + 1 hours;
        bytes memory signature = _signUserAcceptance(jobId, outputCommitment, expiresAt, 0);
        escrow.settleWithUserSignature(jobId, outputCommitment, expiresAt, 0, signature);

        AgentHubEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(uint8(job.status), uint8(AgentHubEscrow.JobStatus.SETTLED));
        assertEq(usdc.balanceOf(providerPayout), 975e6);
        assertEq(usdc.balanceOf(treasury), 25e6);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_SettleWithUserSignatureRevertsWhenExpired() public {
        uint256 jobId = _createJob();
        _startJob(jobId, block.timestamp + 1 hours, 0);

        bytes32 outputCommitment = keccak256("output");
        uint256 expiresAt = block.timestamp + 1 hours;
        bytes memory signature = _signUserAcceptance(jobId, outputCommitment, expiresAt, 0);

        vm.warp(expiresAt + 1);
        vm.expectRevert(AgentHubEscrow.AuthorizationExpired.selector);
        escrow.settleWithUserSignature(jobId, outputCommitment, expiresAt, 0, signature);
    }

    function test_SettleWithUserSignatureRevertsWhenNonceIsNotNextNonce() public {
        uint256 jobId = _createJob();
        _startJob(jobId, block.timestamp + 1 hours, 0);

        bytes32 outputCommitment = keccak256("output");
        uint256 expiresAt = block.timestamp + 1 hours;
        bytes memory signature = _signUserAcceptance(jobId, outputCommitment, expiresAt, 1);

        vm.expectRevert(AgentHubEscrow.InvalidNonce.selector);
        escrow.settleWithUserSignature(jobId, outputCommitment, expiresAt, 1, signature);
    }

    function test_SettleAfterReviewTimeoutWithDeliveryAttestationAfterStartJob() public {
        uint256 jobId = _createJob();
        _startJob(jobId, block.timestamp + 1 hours, 0);

        AgentHubEscrow.Job memory runningJob = escrow.getJob(jobId);
        bytes32 outputCommitment = keccak256("output");
        uint64 deliveredAt = runningJob.workDeadline;
        uint256 expiresAt = uint256(deliveredAt) + runningJob.reviewTimeout + 1 hours;
        bytes memory signature = _signDeliveryAttestation(jobId, outputCommitment, deliveredAt, expiresAt, 0);

        vm.warp(uint256(deliveredAt) + runningJob.reviewTimeout + 1);
        escrow.settleAfterReviewTimeout(jobId, outputCommitment, deliveredAt, expiresAt, 0, signature);

        AgentHubEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(uint8(job.status), uint8(AgentHubEscrow.JobStatus.SETTLED));
        assertEq(usdc.balanceOf(providerPayout), 975e6);
        assertEq(usdc.balanceOf(treasury), 25e6);
    }

    function test_SettleAfterReviewTimeoutRevertsWhenAttestationNonceIsNotNextNonce() public {
        uint256 jobId = _createJob();
        _startJob(jobId, block.timestamp + 1 hours, 0);

        AgentHubEscrow.Job memory runningJob = escrow.getJob(jobId);
        bytes32 outputCommitment = keccak256("output");
        uint64 deliveredAt = runningJob.workDeadline;
        uint256 expiresAt = uint256(deliveredAt) + runningJob.reviewTimeout + 1 hours;
        bytes memory signature = _signDeliveryAttestation(jobId, outputCommitment, deliveredAt, expiresAt, 1);

        vm.warp(uint256(deliveredAt) + runningJob.reviewTimeout + 1);
        vm.expectRevert(AgentHubEscrow.InvalidNonce.selector);
        escrow.settleAfterReviewTimeout(jobId, outputCommitment, deliveredAt, expiresAt, 1, signature);
    }

    function test_RefundWithNoDeliveryAttestationAfterStartJob() public {
        uint256 jobId = _createJob();
        _startJob(jobId, block.timestamp + 1 hours, 0);

        AgentHubEscrow.Job memory runningJob = escrow.getJob(jobId);
        uint64 checkedAt = runningJob.workDeadline + 1;
        uint256 expiresAt = uint256(checkedAt) + 1 hours;
        bytes memory signature = _signNoDeliveryAttestation(jobId, checkedAt, expiresAt, 0);

        vm.warp(checkedAt);
        escrow.refundWithNoDeliveryAttestation(jobId, checkedAt, expiresAt, 0, signature);

        AgentHubEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(uint8(job.status), uint8(AgentHubEscrow.JobStatus.REFUNDED));
        assertEq(usdc.balanceOf(user), 10_000e6);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_RefundAfterQueueTimeoutWorksBeforeRunning() public {
        uint256 jobId = _createJob();
        AgentHubEscrow.Job memory createdJob = escrow.getJob(jobId);

        vm.warp(createdJob.queueDeadline + 1);
        escrow.refundAfterQueueTimeout(jobId);

        AgentHubEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(uint8(job.status), uint8(AgentHubEscrow.JobStatus.REFUNDED));
        assertEq(job.workDeadline, 0);
        assertEq(job.finalRefundDeadline, 0);
        assertEq(usdc.balanceOf(user), 10_000e6);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_RefundAfterFinalTimeoutOnlyWorksAfterRunning() public {
        uint256 jobId = _createJob();

        vm.expectRevert(AgentHubEscrow.JobNotRunning.selector);
        escrow.refundAfterFinalTimeout(jobId);

        _startJob(jobId, block.timestamp + 1 hours, 0);
        AgentHubEscrow.Job memory runningJob = escrow.getJob(jobId);

        vm.warp(runningJob.finalRefundDeadline + 1);
        escrow.refundAfterFinalTimeout(jobId);

        AgentHubEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(uint8(job.status), uint8(AgentHubEscrow.JobStatus.REFUNDED));
        assertEq(usdc.balanceOf(user), 10_000e6);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_CreateJobRevertsWhenServiceIsPaused() public {
        vm.prank(providerOwner);
        registry.setServiceStatus(serviceId, IAgentHubRegistry.ServiceStatus.PAUSED);

        uint256 expiresAt = block.timestamp + 1 hours;
        bytes memory signature = _signCreateJob(ATTESTER_PK, user, serviceId, REQUEST_ID, keccak256("input"), expiresAt);

        vm.prank(user);
        vm.expectRevert(AgentHubEscrow.ServiceNotActive.selector);
        escrow.createJob(serviceId, REQUEST_ID, keccak256("input"), QUEUE_TIMEOUT, expiresAt, signature);
    }

    function test_CreateJobRevertsWhenQueueTimeoutIsNotGreaterThanOneMinute() public {
        uint256 expiresAt = block.timestamp + 1 hours;
        bytes memory signature = _signCreateJob(ATTESTER_PK, user, serviceId, REQUEST_ID, keccak256("input"), expiresAt);

        vm.prank(user);
        vm.expectRevert(AgentHubEscrow.QueueTimeoutTooShort.selector);
        escrow.createJob(serviceId, REQUEST_ID, keccak256("input"), 1 minutes, expiresAt, signature);
    }

    function test_CreateJobRevertsWhenAuthorizationExpired() public {
        uint256 expiresAt = block.timestamp + 1 hours;
        bytes memory signature = _signCreateJob(ATTESTER_PK, user, serviceId, REQUEST_ID, keccak256("input"), expiresAt);

        vm.warp(expiresAt + 1);
        vm.prank(user);
        vm.expectRevert(AgentHubEscrow.AuthorizationExpired.selector);
        escrow.createJob(serviceId, REQUEST_ID, keccak256("input"), QUEUE_TIMEOUT, expiresAt, signature);
    }

    function test_CreateJobRevertsWithWrongAttesterSignature() public {
        uint256 expiresAt = block.timestamp + 1 hours;
        bytes memory signature =
            _signCreateJob(PROVIDER_OWNER_PK, user, serviceId, REQUEST_ID, keccak256("input"), expiresAt);

        vm.prank(user);
        vm.expectRevert(AgentHubEscrow.InvalidSignature.selector);
        escrow.createJob(serviceId, REQUEST_ID, keccak256("input"), QUEUE_TIMEOUT, expiresAt, signature);
    }

    function test_CreateJobRevertsWhenSignedForAnotherUser() public {
        address otherUser = address(0xBAD);
        uint256 expiresAt = block.timestamp + 1 hours;
        bytes memory signature =
            _signCreateJob(ATTESTER_PK, otherUser, serviceId, REQUEST_ID, keccak256("input"), expiresAt);

        vm.prank(user);
        vm.expectRevert(AgentHubEscrow.InvalidSignature.selector);
        escrow.createJob(serviceId, REQUEST_ID, keccak256("input"), QUEUE_TIMEOUT, expiresAt, signature);
    }

    function test_CreateJobRevertsWhenRequestIdWasAlreadyUsed() public {
        _createJob();

        bytes32 otherInputCommitment = keccak256("other input");
        uint256 expiresAt = block.timestamp + 1 hours;
        bytes memory signature =
            _signCreateJob(ATTESTER_PK, user, serviceId, REQUEST_ID, otherInputCommitment, expiresAt);

        vm.prank(user);
        vm.expectRevert(AgentHubEscrow.RequestAlreadyUsed.selector);
        escrow.createJob(serviceId, REQUEST_ID, otherInputCommitment, QUEUE_TIMEOUT, expiresAt, signature);
    }

    function test_CreateJobRevertsWhenServicePriceChangedAfterAuthorization() public {
        uint256 expiresAt = block.timestamp + 1 hours;
        bytes memory signature = _signCreateJob(ATTESTER_PK, user, serviceId, REQUEST_ID, keccak256("input"), expiresAt);

        vm.prank(providerOwner);
        registry.updateServicePrice(serviceId, 2_000e6);

        vm.prank(user);
        vm.expectRevert(AgentHubEscrow.InvalidSignature.selector);
        escrow.createJob(serviceId, REQUEST_ID, keccak256("input"), QUEUE_TIMEOUT, expiresAt, signature);
    }

    function test_CreateJobRevertsWhenQueueTimeoutDiffersFromAuthorization() public {
        uint256 expiresAt = block.timestamp + 1 hours;
        bytes memory signature = _signCreateJob(ATTESTER_PK, user, serviceId, REQUEST_ID, keccak256("input"), expiresAt);

        vm.prank(user);
        vm.expectRevert(AgentHubEscrow.InvalidSignature.selector);
        escrow.createJob(serviceId, REQUEST_ID, keccak256("input"), QUEUE_TIMEOUT + 1 hours, expiresAt, signature);
    }

    function _createJob() private returns (uint256) {
        bytes32 requestId =
            escrow.nextJobId() == 1 ? REQUEST_ID : keccak256(abi.encode("request-id", escrow.nextJobId()));
        uint256 expiresAt = block.timestamp + 1 hours;
        bytes memory signature = _signCreateJob(ATTESTER_PK, user, serviceId, requestId, keccak256("input"), expiresAt);

        vm.prank(user);
        return escrow.createJob(serviceId, requestId, keccak256("input"), QUEUE_TIMEOUT, expiresAt, signature);
    }

    function _startJob(uint256 jobId, uint256 expiresAt, uint256 nonce) private {
        escrow.startJob(jobId, expiresAt, nonce, _signStartJob(PROVIDER_SIGNER_PK, jobId, expiresAt, nonce));
    }

    function _signStartJob(uint256 privateKey, uint256 jobId, uint256 expiresAt, uint256 nonce)
        private
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                escrow.START_JOB_AUTHORIZATION_TYPEHASH(),
                jobId,
                providerId,
                serviceId,
                keccak256("input"),
                expiresAt,
                nonce
            )
        );
        return _sign(privateKey, _typedDataHash(structHash));
    }

    function _signCreateJob(
        uint256 privateKey,
        address authorizedUser,
        uint256 authorizedServiceId,
        bytes32 requestId,
        bytes32 inputCommitment,
        uint256 expiresAt
    ) private view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                escrow.CREATE_JOB_AUTHORIZATION_TYPEHASH(),
                authorizedUser,
                providerId,
                authorizedServiceId,
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

    function _signUserAcceptance(uint256 jobId, bytes32 outputCommitment, uint256 expiresAt, uint256 nonce)
        private
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                escrow.JOB_ACCEPTANCE_TYPEHASH(),
                jobId,
                providerId,
                serviceId,
                keccak256("input"),
                outputCommitment,
                expiresAt,
                nonce
            )
        );
        return _sign(USER_PK, _typedDataHash(structHash));
    }

    function _signDeliveryAttestation(
        uint256 jobId,
        bytes32 outputCommitment,
        uint64 deliveredAt,
        uint256 expiresAt,
        uint256 nonce
    ) private view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                escrow.DELIVERY_ATTESTATION_TYPEHASH(),
                jobId,
                providerId,
                serviceId,
                keccak256("input"),
                outputCommitment,
                deliveredAt,
                expiresAt,
                nonce
            )
        );
        return _sign(ATTESTER_PK, _typedDataHash(structHash));
    }

    function _signNoDeliveryAttestation(uint256 jobId, uint64 checkedAt, uint256 expiresAt, uint256 nonce)
        private
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                escrow.NO_DELIVERY_ATTESTATION_TYPEHASH(),
                jobId,
                providerId,
                serviceId,
                keccak256("input"),
                checkedAt,
                expiresAt,
                nonce
            )
        );
        return _sign(ATTESTER_PK, _typedDataHash(structHash));
    }

    function _typedDataHash(bytes32 structHash) private view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", escrow.domainSeparator(), structHash));
    }

    function _sign(uint256 privateKey, bytes32 digest) private pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
