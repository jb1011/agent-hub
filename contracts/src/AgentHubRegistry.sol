// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {IAgentHubConfig} from "./interfaces/IAgentHubConfig.sol";
import {IAgentHubRegistry} from "./interfaces/IAgentHubRegistry.sol";

contract AgentHubRegistry is IAgentHubRegistry {
    error NotAdmin();
    error NotProviderOwnerOrAdmin();
    error ZeroAddress();
    error InvalidProvider();
    error InvalidPrice();
    error InvalidTimeout();

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
    event ProviderSignerUpdated(uint256 indexed providerId, address indexed signer);
    event ProviderPayoutWalletUpdated(uint256 indexed providerId, address indexed payoutWallet);
    event ProviderPriceUpdated(uint256 indexed providerId, uint256 price);
    event ProviderWorkTimeoutUpdated(uint256 indexed providerId, uint64 workTimeout);
    event ProviderStatusUpdated(uint256 indexed providerId, ProviderStatus status);
    event ProviderTrustLevelUpdated(uint256 indexed providerId, uint8 trustLevel);

    modifier onlyAdmin() {
        if (msg.sender != CONFIG.owner()) revert NotAdmin();
        _;
    }

    constructor(address config_) {
        if (config_ == address(0)) revert ZeroAddress();
        CONFIG = IAgentHubConfig(config_);
    }

    function config() external view returns (IAgentHubConfig) {
        return CONFIG;
    }

    function registerProvider(
        address signer,
        address payoutWallet,
        uint256 price,
        uint64 workTimeout,
        bytes32 metadataCommitment
    )
        external
        returns (uint256 providerId)
    {
        if (signer == address(0) || payoutWallet == address(0)) revert ZeroAddress();
        if (price == 0) revert InvalidPrice();
        if (workTimeout == 0) revert InvalidTimeout();

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

    function updateProviderSigner(uint256 providerId, address signer) external {
        if (signer == address(0)) revert ZeroAddress();
        Provider storage provider = _existingProvider(providerId);
        _requireProviderOwnerOrAdmin(provider);
        provider.signer = signer;
        emit ProviderSignerUpdated(providerId, signer);
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
}
