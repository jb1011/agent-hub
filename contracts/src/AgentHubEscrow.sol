// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IAgentHubConfig} from "./interfaces/IAgentHubConfig.sol";
import {IAgentHubRegistry} from "./interfaces/IAgentHubRegistry.sol";

contract AgentHubEscrow is ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    uint64 public constant MIN_QUEUE_TIMEOUT_SECONDS = 60;

    enum JobStatus {
        NONE,
        FUNDED,
        RUNNING,
        SETTLED,
        REFUNDED
    }

    struct Job {
        address user;
        address providerPayoutWallet;
        address treasury;
        address deliveryAttester;
        uint256 providerId;
        uint256 price;
        uint256 protocolFee;
        uint64 queueDeadline;
        uint64 startedAt;
        uint64 workTimeout;
        uint64 workDeadline;
        uint64 reviewTimeout;
        uint64 finalRefundDeadline;
        uint64 deliveredAt;
        uint64 settledAt;
        uint64 refundedAt;
        JobStatus status;
        bytes32 requestId;
        bytes32 inputCommitment;
        bytes32 outputCommitment;
    }

    error ZeroAddress();
    error InvalidCommitment();
    error ProviderNotActive();
    error InvalidJob();
    error JobNotQueued();
    error JobNotRunning();
    error QueueDeadlineExceeded();
    error QueueDeadlineNotElapsed();
    error QueueTimeoutTooShort();
    error AuthorizationExpired();
    error InvalidRequestId();
    error RequestAlreadyUsed();
    error WorkDeadlineExceeded();
    error DeliveredBeforeStart();
    error FutureDeliveredAt();
    error ReviewTimeoutNotElapsed();
    error FinalRefundDeadlineNotElapsed();
    error CheckedBeforeWorkDeadline();
    error FutureCheckedAt();
    error InvalidSignature();

    bytes32 public constant CREATE_JOB_AUTHORIZATION_TYPEHASH = keccak256(
        "CreateJobAuthorization(address user,uint256 providerId,uint256 price,uint64 workTimeout,uint64 queueTimeoutSeconds,bytes32 requestId,bytes32 inputCommitment,uint256 expiresAt)"
    );
    bytes32 public constant START_JOB_AUTHORIZATION_TYPEHASH = keccak256(
        "StartJobAuthorization(uint256 jobId,uint256 providerId,bytes32 inputCommitment,uint256 expiresAt)"
    );
    bytes32 public constant JOB_ACCEPTANCE_TYPEHASH = keccak256(
        "JobAcceptance(uint256 jobId,uint256 providerId,bytes32 inputCommitment,bytes32 outputCommitment,uint256 expiresAt)"
    );
    bytes32 public constant DELIVERY_ATTESTATION_TYPEHASH = keccak256(
        "DeliveryAttestation(uint256 jobId,uint256 providerId,bytes32 inputCommitment,bytes32 outputCommitment,uint256 deliveredAt,uint256 expiresAt)"
    );
    bytes32 public constant NO_DELIVERY_ATTESTATION_TYPEHASH = keccak256(
        "NoDeliveryAttestation(uint256 jobId,uint256 providerId,bytes32 inputCommitment,uint256 checkedAt,uint256 expiresAt)"
    );

    IAgentHubConfig private immutable CONFIG;
    IAgentHubRegistry private immutable REGISTRY;
    IERC20 private immutable PAYMENT_TOKEN;
    uint256 public nextJobId = 1;

    mapping(uint256 jobId => Job job) private _jobs;
    mapping(bytes32 requestId => bool used) public usedRequestIds;

    event JobCreated(
        uint256 indexed jobId,
        address indexed user,
        uint256 indexed providerId,
        uint64 queueDeadline,
        uint256 price,
        uint256 protocolFee,
        address providerPayoutWallet,
        address treasury,
        bytes32 requestId,
        bytes32 inputCommitment
    );
    event JobStarted(
        uint256 indexed jobId,
        uint256 indexed providerId,
        uint64 startedAt,
        uint64 workDeadline,
        uint64 finalRefundDeadline
    );
    event JobSettledWithUserSignature(
        uint256 indexed jobId,
        bytes32 outputCommitment,
        address providerPayoutWallet,
        uint256 providerAmount,
        uint256 protocolFee
    );
    event JobSettledAfterReviewTimeout(
        uint256 indexed jobId,
        bytes32 outputCommitment,
        uint64 deliveredAt,
        address providerPayoutWallet,
        uint256 providerAmount,
        uint256 protocolFee
    );
    event JobRefundedWithNoDeliveryAttestation(uint256 indexed jobId, uint64 checkedAt, uint256 amount);
    event JobRefundedAfterQueueTimeout(uint256 indexed jobId, uint256 amount);
    event JobRefundedAfterFinalTimeout(uint256 indexed jobId, uint256 amount);

    constructor(address config_, address registry_) EIP712("AgentHubEscrow", "1") {
        if (config_ == address(0) || registry_ == address(0)) revert ZeroAddress();
        CONFIG = IAgentHubConfig(config_);
        REGISTRY = IAgentHubRegistry(registry_);

        address token = IAgentHubConfig(config_).paymentToken();
        if (token == address(0)) revert ZeroAddress();
        PAYMENT_TOKEN = IERC20(token);
    }

    function createJob(
        uint256 providerId,
        bytes32 requestId,
        bytes32 inputCommitment,
        uint64 queueTimeoutSeconds,
        uint256 expiresAt,
        bytes calldata deliveryAttesterSignature
    ) external nonReentrant returns (uint256 jobId) {
        if (block.timestamp > expiresAt) revert AuthorizationExpired();
        if (requestId == bytes32(0)) revert InvalidRequestId();
        if (inputCommitment == bytes32(0)) revert InvalidCommitment();
        if (usedRequestIds[requestId]) revert RequestAlreadyUsed();
        if (queueTimeoutSeconds < MIN_QUEUE_TIMEOUT_SECONDS) revert QueueTimeoutTooShort();

        IAgentHubRegistry.Provider memory provider = REGISTRY.getProvider(providerId);
        if (provider.status != IAgentHubRegistry.ProviderStatus.ACTIVE) revert ProviderNotActive();

        _requireCreateJobAuthorization(
            providerId, provider, queueTimeoutSeconds, requestId, inputCommitment, expiresAt, deliveryAttesterSignature
        );

        uint256 protocolFee = provider.price * CONFIG.protocolFeeBps() / 10_000;
        uint64 queueDeadline = (block.timestamp + queueTimeoutSeconds).toUint64();
        uint64 reviewTimeout = CONFIG.reviewTimeoutSeconds();

        jobId = nextJobId++;
        usedRequestIds[requestId] = true;

        Job storage job = _jobs[jobId];
        job.user = msg.sender;
        job.providerId = providerId;
        job.price = provider.price;
        job.protocolFee = protocolFee;
        job.providerPayoutWallet = provider.payoutWallet;
        job.treasury = CONFIG.treasury();
        job.deliveryAttester = CONFIG.deliveryAttester();
        job.queueDeadline = queueDeadline;
        job.workTimeout = provider.workTimeout;
        job.reviewTimeout = reviewTimeout;
        job.status = JobStatus.FUNDED;
        job.requestId = requestId;
        job.inputCommitment = inputCommitment;

        PAYMENT_TOKEN.safeTransferFrom(msg.sender, address(this), provider.price);

        _emitJobCreated(jobId);
    }

    function startJob(uint256 jobId, uint256 expiresAt, bytes calldata providerSignature) external nonReentrant {
        Job storage job = _queuedJob(jobId);
        if (block.timestamp > job.queueDeadline) revert QueueDeadlineExceeded();
        if (block.timestamp > expiresAt) revert AuthorizationExpired();

        bytes32 structHash =
            _hashStartJobAuthorization(jobId, job.providerId, job.inputCommitment, expiresAt);
        address signer = ECDSA.recoverCalldata(_hashTypedDataV4(structHash), providerSignature);
        IAgentHubRegistry.Provider memory provider = REGISTRY.getProvider(job.providerId);
        if (provider.status != IAgentHubRegistry.ProviderStatus.ACTIVE) revert ProviderNotActive();
        if (signer != provider.signer) revert InvalidSignature();

        uint64 startedAt = block.timestamp.toUint64();
        uint64 workDeadline = (block.timestamp + job.workTimeout).toUint64();
        uint64 finalRefundDeadline =
            (uint256(workDeadline) + job.reviewTimeout + CONFIG.refundGracePeriodSeconds()).toUint64();

        job.status = JobStatus.RUNNING;
        job.startedAt = startedAt;
        job.workDeadline = workDeadline;
        job.finalRefundDeadline = finalRefundDeadline;

        emit JobStarted(jobId, job.providerId, startedAt, workDeadline, finalRefundDeadline);
    }

    function settleWithUserSignature(
        uint256 jobId,
        bytes32 outputCommitment,
        uint256 expiresAt,
        bytes calldata userSignature
    ) external nonReentrant {
        if (outputCommitment == bytes32(0)) revert InvalidCommitment();
        if (block.timestamp > expiresAt) revert AuthorizationExpired();
        Job storage job = _runningJob(jobId);

        bytes32 structHash =
            _hashJobAcceptance(jobId, job.providerId, job.inputCommitment, outputCommitment, expiresAt);
        if (ECDSA.recoverCalldata(_hashTypedDataV4(structHash), userSignature) != job.user) revert InvalidSignature();

        uint256 providerAmount = _settle(job, outputCommitment, 0);
        emit JobSettledWithUserSignature(
            jobId, outputCommitment, job.providerPayoutWallet, providerAmount, job.protocolFee
        );
    }

    function settleAfterReviewTimeout(
        uint256 jobId,
        bytes32 outputCommitment,
        uint256 deliveredAt,
        uint256 expiresAt,
        bytes calldata deliveryAttesterSignature
    ) external nonReentrant {
        if (outputCommitment == bytes32(0)) revert InvalidCommitment();
        if (block.timestamp > expiresAt) revert AuthorizationExpired();
        Job storage job = _runningJob(jobId);
        if (deliveredAt < job.startedAt) revert DeliveredBeforeStart();
        if (deliveredAt > job.workDeadline) revert WorkDeadlineExceeded();
        if (deliveredAt > block.timestamp) revert FutureDeliveredAt();
        uint64 deliveredAt64 = deliveredAt.toUint64();
        if (block.timestamp <= deliveredAt + job.reviewTimeout) revert ReviewTimeoutNotElapsed();

        bytes32 structHash = _hashDeliveryAttestation(
            jobId, job.providerId, job.inputCommitment, outputCommitment, deliveredAt, expiresAt
        );
        if (ECDSA.recoverCalldata(_hashTypedDataV4(structHash), deliveryAttesterSignature) != job.deliveryAttester) {
            revert InvalidSignature();
        }

        uint256 providerAmount = _settle(job, outputCommitment, deliveredAt64);
        emit JobSettledAfterReviewTimeout(
            jobId, outputCommitment, deliveredAt64, job.providerPayoutWallet, providerAmount, job.protocolFee
        );
    }

    function refundWithNoDeliveryAttestation(
        uint256 jobId,
        uint256 checkedAt,
        uint256 expiresAt,
        bytes calldata noDeliveryAttesterSignature
    ) external nonReentrant {
        if (block.timestamp > expiresAt) revert AuthorizationExpired();
        Job storage job = _runningJob(jobId);
        if (checkedAt <= job.workDeadline) revert CheckedBeforeWorkDeadline();
        if (checkedAt > block.timestamp) revert FutureCheckedAt();
        uint64 checkedAt64 = checkedAt.toUint64();

        bytes32 structHash =
            _hashNoDeliveryAttestation(jobId, job.providerId, job.inputCommitment, checkedAt, expiresAt);
        if (ECDSA.recoverCalldata(_hashTypedDataV4(structHash), noDeliveryAttesterSignature) != job.deliveryAttester) {
            revert InvalidSignature();
        }

        uint256 amount = _refund(job);

        emit JobRefundedWithNoDeliveryAttestation(jobId, checkedAt64, amount);
    }

    function refundAfterQueueTimeout(uint256 jobId) external nonReentrant {
        Job storage job = _queuedJob(jobId);
        if (block.timestamp <= job.queueDeadline) revert QueueDeadlineNotElapsed();

        uint256 amount = _refund(job);

        emit JobRefundedAfterQueueTimeout(jobId, amount);
    }

    function refundAfterFinalTimeout(uint256 jobId) external nonReentrant {
        Job storage job = _runningJob(jobId);
        if (block.timestamp <= job.finalRefundDeadline) revert FinalRefundDeadlineNotElapsed();

        uint256 amount = _refund(job);

        emit JobRefundedAfterFinalTimeout(jobId, amount);
    }

    function getJob(uint256 jobId) external view returns (Job memory) {
        Job memory job = _jobs[jobId];
        if (job.user == address(0)) revert InvalidJob();
        return job;
    }

    function domainSeparator() public view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function config() external view returns (IAgentHubConfig) {
        return CONFIG;
    }

    function registry() external view returns (IAgentHubRegistry) {
        return REGISTRY;
    }

    function paymentToken() external view returns (IERC20) {
        return PAYMENT_TOKEN;
    }

    function _settle(Job storage job, bytes32 outputCommitment, uint64 deliveredAt)
        private
        returns (uint256 providerAmount)
    {
        job.status = JobStatus.SETTLED;
        job.outputCommitment = outputCommitment;
        job.deliveredAt = deliveredAt;
        job.settledAt = block.timestamp.toUint64();
        providerAmount = job.price - job.protocolFee;

        if (providerAmount != 0) PAYMENT_TOKEN.safeTransfer(job.providerPayoutWallet, providerAmount);
        if (job.protocolFee != 0) PAYMENT_TOKEN.safeTransfer(job.treasury, job.protocolFee);
    }

    function _refund(Job storage job) private returns (uint256 amount) {
        job.status = JobStatus.REFUNDED;
        job.refundedAt = block.timestamp.toUint64();
        amount = job.price;
        PAYMENT_TOKEN.safeTransfer(job.user, amount);
    }

    function _emitJobCreated(uint256 jobId) private {
        Job storage job = _jobs[jobId];
        emit JobCreated(
            jobId,
            job.user,
            job.providerId,
            job.queueDeadline,
            job.price,
            job.protocolFee,
            job.providerPayoutWallet,
            job.treasury,
            job.requestId,
            job.inputCommitment
        );
    }

    function _queuedJob(uint256 jobId) private view returns (Job storage job) {
        job = _jobs[jobId];
        if (job.user == address(0)) revert InvalidJob();
        if (job.status != JobStatus.FUNDED) revert JobNotQueued();
    }

    function _runningJob(uint256 jobId) private view returns (Job storage job) {
        job = _jobs[jobId];
        if (job.user == address(0)) revert InvalidJob();
        if (job.status != JobStatus.RUNNING) revert JobNotRunning();
    }

    function _requireCreateJobAuthorization(
        uint256 providerId,
        IAgentHubRegistry.Provider memory provider,
        uint64 queueTimeoutSeconds,
        bytes32 requestId,
        bytes32 inputCommitment,
        uint256 expiresAt,
        bytes calldata deliveryAttesterSignature
    ) private view {
        bytes32 structHash = _hashCreateJobAuthorization(
            msg.sender, providerId, provider, queueTimeoutSeconds, requestId, inputCommitment, expiresAt
        );
        if (ECDSA.recoverCalldata(_hashTypedDataV4(structHash), deliveryAttesterSignature) != CONFIG.deliveryAttester())
        {
            revert InvalidSignature();
        }
    }

    function _hashCreateJobAuthorization(
        address user,
        uint256 providerId,
        IAgentHubRegistry.Provider memory provider,
        uint64 queueTimeoutSeconds,
        bytes32 requestId,
        bytes32 inputCommitment,
        uint256 expiresAt
    ) private pure returns (bytes32 structHash) {
        bytes32 typeHash = CREATE_JOB_AUTHORIZATION_TYPEHASH;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, typeHash)
            mstore(add(ptr, 0x20), user)
            mstore(add(ptr, 0x40), providerId)
            mstore(add(ptr, 0x60), mload(add(provider, 0x60)))
            mstore(add(ptr, 0x80), mload(add(provider, 0x80)))
            mstore(add(ptr, 0xa0), queueTimeoutSeconds)
            mstore(add(ptr, 0xc0), requestId)
            mstore(add(ptr, 0xe0), inputCommitment)
            mstore(add(ptr, 0x100), expiresAt)
            mstore(0x40, add(ptr, 0x120))
            structHash := keccak256(ptr, 0x120)
        }
    }

    function _hashStartJobAuthorization(
        uint256 jobId,
        uint256 providerId,
        bytes32 inputCommitment,
        uint256 expiresAt
    ) private pure returns (bytes32 structHash) {
        bytes32 typeHash = START_JOB_AUTHORIZATION_TYPEHASH;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, typeHash)
            mstore(add(ptr, 0x20), jobId)
            mstore(add(ptr, 0x40), providerId)
            mstore(add(ptr, 0x60), inputCommitment)
            mstore(add(ptr, 0x80), expiresAt)
            mstore(0x40, add(ptr, 0xa0))
            structHash := keccak256(ptr, 0xa0)
        }
    }

    function _hashJobAcceptance(
        uint256 jobId,
        uint256 providerId,
        bytes32 inputCommitment,
        bytes32 outputCommitment,
        uint256 expiresAt
    ) private pure returns (bytes32 structHash) {
        bytes32 typeHash = JOB_ACCEPTANCE_TYPEHASH;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, typeHash)
            mstore(add(ptr, 0x20), jobId)
            mstore(add(ptr, 0x40), providerId)
            mstore(add(ptr, 0x60), inputCommitment)
            mstore(add(ptr, 0x80), outputCommitment)
            mstore(add(ptr, 0xa0), expiresAt)
            mstore(0x40, add(ptr, 0xc0))
            structHash := keccak256(ptr, 0xc0)
        }
    }

    function _hashDeliveryAttestation(
        uint256 jobId,
        uint256 providerId,
        bytes32 inputCommitment,
        bytes32 outputCommitment,
        uint256 deliveredAt,
        uint256 expiresAt
    ) private pure returns (bytes32 structHash) {
        bytes32 typeHash = DELIVERY_ATTESTATION_TYPEHASH;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, typeHash)
            mstore(add(ptr, 0x20), jobId)
            mstore(add(ptr, 0x40), providerId)
            mstore(add(ptr, 0x60), inputCommitment)
            mstore(add(ptr, 0x80), outputCommitment)
            mstore(add(ptr, 0xa0), deliveredAt)
            mstore(add(ptr, 0xc0), expiresAt)
            mstore(0x40, add(ptr, 0xe0))
            structHash := keccak256(ptr, 0xe0)
        }
    }

    function _hashNoDeliveryAttestation(
        uint256 jobId,
        uint256 providerId,
        bytes32 inputCommitment,
        uint256 checkedAt,
        uint256 expiresAt
    ) private pure returns (bytes32 structHash) {
        bytes32 typeHash = NO_DELIVERY_ATTESTATION_TYPEHASH;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, typeHash)
            mstore(add(ptr, 0x20), jobId)
            mstore(add(ptr, 0x40), providerId)
            mstore(add(ptr, 0x60), inputCommitment)
            mstore(add(ptr, 0x80), checkedAt)
            mstore(add(ptr, 0xa0), expiresAt)
            mstore(0x40, add(ptr, 0xc0))
            structHash := keccak256(ptr, 0xc0)
        }
    }
}
