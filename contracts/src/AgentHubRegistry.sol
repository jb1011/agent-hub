// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {IAgentHubConfig} from "./interfaces/IAgentHubConfig.sol";
import {IAgentHubRegistry} from "./interfaces/IAgentHubRegistry.sol";

contract AgentHubRegistry is IAgentHubRegistry {
    error NotAdmin();
    error NotProviderOwner();
    error NotProviderOwnerOrAdmin();
    error NotServiceOwnerOrAdmin();
    error ZeroAddress();
    error InvalidProvider();
    error InvalidService();
    error InvalidPrice();
    error InvalidTimeout();
    error ProviderNotActive();

    IAgentHubConfig private immutable CONFIG;
    uint256 public nextProviderId = 1;
    uint256 public nextServiceId = 1;

    mapping(uint256 providerId => Provider provider) private _providers;
    mapping(uint256 serviceId => Service service) private _services;

    event ProviderRegistered(
        uint256 indexed providerId,
        address indexed owner,
        address indexed signer,
        address payoutWallet,
        bytes32 metadataCommitment
    );
    event ProviderMetadataUpdated(uint256 indexed providerId, bytes32 metadataCommitment);
    event ProviderSignerUpdated(uint256 indexed providerId, address indexed signer);
    event ProviderPayoutWalletUpdated(uint256 indexed providerId, address indexed payoutWallet);
    event ProviderStatusUpdated(uint256 indexed providerId, ProviderStatus status);
    event ProviderTrustLevelUpdated(uint256 indexed providerId, uint8 trustLevel);
    event ServiceRegistered(
        uint256 indexed serviceId,
        uint256 indexed providerId,
        uint256 price,
        uint64 workTimeout,
        bytes32 metadataCommitment
    );
    event ServiceMetadataUpdated(uint256 indexed serviceId, bytes32 metadataCommitment);
    event ServicePriceUpdated(uint256 indexed serviceId, uint256 price);
    event ServiceWorkTimeoutUpdated(uint256 indexed serviceId, uint64 workTimeout);
    event ServiceStatusUpdated(uint256 indexed serviceId, ServiceStatus status);

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

    function registerProvider(address signer, address payoutWallet, bytes32 metadataCommitment)
        external
        returns (uint256 providerId)
    {
        if (signer == address(0) || payoutWallet == address(0)) revert ZeroAddress();

        providerId = nextProviderId++;
        _providers[providerId] = Provider({
            owner: msg.sender,
            signer: signer,
            payoutWallet: payoutWallet,
            status: ProviderStatus.ACTIVE,
            trustLevel: 0,
            metadataCommitment: metadataCommitment
        });

        emit ProviderRegistered(providerId, msg.sender, signer, payoutWallet, metadataCommitment);
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

    function registerService(uint256 providerId, uint256 price, uint64 workTimeout, bytes32 metadataCommitment)
        external
        returns (uint256 serviceId)
    {
        if (price == 0) revert InvalidPrice();
        if (workTimeout == 0) revert InvalidTimeout();

        Provider storage provider = _existingProvider(providerId);
        if (msg.sender != provider.owner) revert NotProviderOwner();
        if (provider.status != ProviderStatus.ACTIVE) revert ProviderNotActive();

        serviceId = nextServiceId++;
        _services[serviceId] = Service({
            providerId: providerId,
            price: price,
            workTimeout: workTimeout,
            status: ServiceStatus.ACTIVE,
            metadataCommitment: metadataCommitment
        });

        emit ServiceRegistered(serviceId, providerId, price, workTimeout, metadataCommitment);
    }

    function updateServiceMetadata(uint256 serviceId, bytes32 metadataCommitment) external {
        Service storage service = _existingService(serviceId);
        _requireServiceOwnerOrAdmin(service);
        service.metadataCommitment = metadataCommitment;
        emit ServiceMetadataUpdated(serviceId, metadataCommitment);
    }

    function updateServicePrice(uint256 serviceId, uint256 price) external {
        if (price == 0) revert InvalidPrice();
        Service storage service = _existingService(serviceId);
        _requireServiceOwnerOrAdmin(service);
        service.price = price;
        emit ServicePriceUpdated(serviceId, price);
    }

    function updateServiceWorkTimeout(uint256 serviceId, uint64 workTimeout) external {
        if (workTimeout == 0) revert InvalidTimeout();
        Service storage service = _existingService(serviceId);
        _requireServiceOwnerOrAdmin(service);
        service.workTimeout = workTimeout;
        emit ServiceWorkTimeoutUpdated(serviceId, workTimeout);
    }

    function setServiceStatus(uint256 serviceId, ServiceStatus status) external {
        if (status == ServiceStatus.NONE) revert InvalidService();
        Service storage service = _existingService(serviceId);
        _requireServiceOwnerOrAdmin(service);
        service.status = status;
        emit ServiceStatusUpdated(serviceId, status);
    }

    function getService(uint256 serviceId) external view override returns (Service memory) {
        Service memory service = _services[serviceId];
        if (service.providerId == 0) revert InvalidService();
        return service;
    }

    function _existingProvider(uint256 providerId) private view returns (Provider storage provider) {
        provider = _providers[providerId];
        if (provider.owner == address(0)) revert InvalidProvider();
    }

    function _existingService(uint256 serviceId) private view returns (Service storage service) {
        service = _services[serviceId];
        if (service.providerId == 0) revert InvalidService();
    }

    function _requireProviderOwnerOrAdmin(Provider storage provider) private view {
        if (msg.sender != provider.owner && msg.sender != CONFIG.owner()) revert NotProviderOwnerOrAdmin();
    }

    function _requireServiceOwnerOrAdmin(Service storage service) private view {
        Provider storage provider = _existingProvider(service.providerId);
        if (msg.sender != provider.owner && msg.sender != CONFIG.owner()) revert NotServiceOwnerOrAdmin();
    }
}
