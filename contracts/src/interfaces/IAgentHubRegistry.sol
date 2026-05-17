// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

interface IAgentHubRegistry {
    enum ProviderStatus {
        NONE,
        ACTIVE,
        PAUSED,
        DISABLED
    }

    enum ServiceStatus {
        NONE,
        ACTIVE,
        PAUSED,
        DISABLED
    }

    struct Provider {
        address owner;
        address signer;
        address payoutWallet;
        ProviderStatus status;
        uint8 trustLevel;
        bytes32 metadataCommitment;
    }

    struct Service {
        uint256 providerId;
        uint256 price;
        uint64 workTimeout;
        ServiceStatus status;
        bytes32 metadataCommitment;
    }

    function getProvider(uint256 providerId) external view returns (Provider memory);
    function getService(uint256 serviceId) external view returns (Service memory);
}
