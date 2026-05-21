// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

import {IAgentHubConfig} from "./interfaces/IAgentHubConfig.sol";
import {IAgentHubRegistry} from "./interfaces/IAgentHubRegistry.sol";

contract AgentHubRegistry is IAgentHubRegistry, EIP712 {
    error NotAdmin();
    error NotProviderOwnerOrAdmin();
    error ZeroAddress();
    error InvalidProvider();
    error InvalidPrice();
    error InvalidTimeout();
    error AuthorizationExpired();
    error InvalidSignature();

    bytes32 public constant REGISTER_PROVIDER_AUTHORIZATION_TYPEHASH = keccak256(
        "RegisterProviderAuthorization(address owner,address signer,address payoutWallet,uint256 price,uint64 workTimeout,bytes32 metadataCommitment,uint256 expiresAt)"
    );

    IAgentHubConfig private immutable CONFIG;
    uint256 public nextProviderId = 1;

    mapping(uint256 providerId => Provider provider) private _providers;

    event ProviderRegistered(
        uint256 indexed providerId,
        address indexed owner,
        address indexed signer,
        address payoutWallet,
        uint256 price,
        uint64 workTimeout,
        bytes32 metadataCommitment
    );
    event ProviderMetadataUpdated(uint256 indexed providerId, bytes32 metadataCommitment);
    event ProviderPayoutWalletUpdated(uint256 indexed providerId, address indexed payoutWallet);
    event ProviderPriceUpdated(uint256 indexed providerId, uint256 price);
    event ProviderWorkTimeoutUpdated(uint256 indexed providerId, uint64 workTimeout);
    event ProviderStatusUpdated(uint256 indexed providerId, ProviderStatus status);
    event ProviderTrustLevelUpdated(uint256 indexed providerId, uint8 trustLevel);

    modifier onlyAdmin() {
        if (msg.sender != CONFIG.owner()) revert NotAdmin();
        _;
    }

    constructor(address config_) EIP712("AgentHubRegistry", "1") {
        if (config_ == address(0)) revert ZeroAddress();
        CONFIG = IAgentHubConfig(config_);
    }

    function config() external view returns (IAgentHubConfig) {
        return CONFIG;
    }

    function domainSeparator() public view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function registerProvider(
        address signer,
        address payoutWallet,
        uint256 price,
        uint64 workTimeout,
        bytes32 metadataCommitment,
        uint256 expiresAt,
        bytes calldata registrationAttesterSignature
    ) external returns (uint256 providerId) {
        if (block.timestamp > expiresAt) revert AuthorizationExpired();
        if (signer == address(0) || payoutWallet == address(0)) revert ZeroAddress();
        if (price == 0) revert InvalidPrice();
        if (workTimeout == 0) revert InvalidTimeout();

        _requireRegisterProviderAuthorization(
            signer, payoutWallet, price, workTimeout, metadataCommitment, expiresAt, registrationAttesterSignature
        );

        providerId = nextProviderId++;
        _providers[providerId] = Provider({
            owner: msg.sender,
            signer: signer,
            payoutWallet: payoutWallet,
            price: price,
            workTimeout: workTimeout,
            status: ProviderStatus.ACTIVE,
            trustLevel: 0,
            metadataCommitment: metadataCommitment
        });

        emit ProviderRegistered(providerId, msg.sender, signer, payoutWallet, price, workTimeout, metadataCommitment);
    }

    function updateProviderMetadata(uint256 providerId, bytes32 metadataCommitment) external {
        Provider storage provider = _existingProvider(providerId);
        _requireProviderOwnerOrAdmin(provider);
        provider.metadataCommitment = metadataCommitment;
        emit ProviderMetadataUpdated(providerId, metadataCommitment);
    }

    function updateProviderPayoutWallet(uint256 providerId, address payoutWallet) external {
        if (payoutWallet == address(0)) revert ZeroAddress();
        Provider storage provider = _existingProvider(providerId);
        _requireProviderOwnerOrAdmin(provider);
        provider.payoutWallet = payoutWallet;
        emit ProviderPayoutWalletUpdated(providerId, payoutWallet);
    }

    function updateProviderPrice(uint256 providerId, uint256 price) external {
        if (price == 0) revert InvalidPrice();
        Provider storage provider = _existingProvider(providerId);
        _requireProviderOwnerOrAdmin(provider);
        provider.price = price;
        emit ProviderPriceUpdated(providerId, price);
    }

    function updateProviderWorkTimeout(uint256 providerId, uint64 workTimeout) external {
        if (workTimeout == 0) revert InvalidTimeout();
        Provider storage provider = _existingProvider(providerId);
        _requireProviderOwnerOrAdmin(provider);
        provider.workTimeout = workTimeout;
        emit ProviderWorkTimeoutUpdated(providerId, workTimeout);
    }

    function setProviderStatus(uint256 providerId, ProviderStatus status) external onlyAdmin {
        if (status == ProviderStatus.NONE) revert InvalidProvider();
        Provider storage provider = _existingProvider(providerId);
        provider.status = status;
        emit ProviderStatusUpdated(providerId, status);
    }

    function setProviderTrustLevel(uint256 providerId, uint8 trustLevel) external onlyAdmin {
        Provider storage provider = _existingProvider(providerId);
        provider.trustLevel = trustLevel;
        emit ProviderTrustLevelUpdated(providerId, trustLevel);
    }

    function getProvider(uint256 providerId) external view override returns (Provider memory) {
        Provider memory provider = _providers[providerId];
        if (provider.owner == address(0)) revert InvalidProvider();
        return provider;
    }

    function _existingProvider(uint256 providerId) private view returns (Provider storage provider) {
        provider = _providers[providerId];
        if (provider.owner == address(0)) revert InvalidProvider();
    }

    function _requireProviderOwnerOrAdmin(Provider storage provider) private view {
        if (msg.sender != provider.owner && msg.sender != CONFIG.owner()) revert NotProviderOwnerOrAdmin();
    }

    function _requireRegisterProviderAuthorization(
        address signer,
        address payoutWallet,
        uint256 price,
        uint64 workTimeout,
        bytes32 metadataCommitment,
        uint256 expiresAt,
        bytes calldata registrationAttesterSignature
    ) private view {
        bytes32 structHash = _hashRegisterProviderAuthorization(
            msg.sender, signer, payoutWallet, price, workTimeout, metadataCommitment, expiresAt
        );
        if (
            ECDSA.recoverCalldata(_hashTypedDataV4(structHash), registrationAttesterSignature)
                != CONFIG.deliveryAttester()
        ) {
            revert InvalidSignature();
        }
    }

    function _hashRegisterProviderAuthorization(
        address owner,
        address signer,
        address payoutWallet,
        uint256 price,
        uint64 workTimeout,
        bytes32 metadataCommitment,
        uint256 expiresAt
    ) private pure returns (bytes32 structHash) {
        bytes32 typeHash = REGISTER_PROVIDER_AUTHORIZATION_TYPEHASH;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, typeHash)
            mstore(add(ptr, 0x20), owner)
            mstore(add(ptr, 0x40), signer)
            mstore(add(ptr, 0x60), payoutWallet)
            mstore(add(ptr, 0x80), price)
            mstore(add(ptr, 0xa0), workTimeout)
            mstore(add(ptr, 0xc0), metadataCommitment)
            mstore(add(ptr, 0xe0), expiresAt)
            mstore(0x40, add(ptr, 0x100))
            structHash := keccak256(ptr, 0x100)
        }
    }
}
