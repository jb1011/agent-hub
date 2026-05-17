// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

interface IAgentHubConfig {
    function owner() external view returns (address);
    function paymentToken() external view returns (address);
    function treasury() external view returns (address);
    function protocolFeeBps() external view returns (uint16);
    function deliveryAttester() external view returns (address);
    function reviewTimeoutSeconds() external view returns (uint64);
    function refundGracePeriodSeconds() external view returns (uint64);
}
