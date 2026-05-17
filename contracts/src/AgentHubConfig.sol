// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

contract AgentHubConfig is Ownable2Step {
    error ZeroAddress();
    error FeeTooHigh();
    error InvalidTimeout();

    uint16 public constant MAX_PROTOCOL_FEE_BPS = 1_000;

    address public paymentToken;
    address public treasury;
    uint16 public protocolFeeBps;
    address public deliveryAttester;
    uint64 public reviewTimeoutSeconds;
    uint64 public refundGracePeriodSeconds;

    event TreasuryUpdated(address indexed treasury);
    event ProtocolFeeBpsUpdated(uint16 protocolFeeBps);
    event DeliveryAttesterUpdated(address indexed deliveryAttester);
    event ReviewTimeoutSecondsUpdated(uint64 reviewTimeoutSeconds);
    event RefundGracePeriodSecondsUpdated(uint64 refundGracePeriodSeconds);

    constructor(
        address initialOwner,
        address initialPaymentToken,
        address initialTreasury,
        uint16 initialProtocolFeeBps,
        address initialDeliveryAttester,
        uint64 initialReviewTimeoutSeconds,
        uint64 initialRefundGracePeriodSeconds
    ) Ownable(initialOwner) {
        if (initialPaymentToken == address(0) || initialTreasury == address(0) || initialDeliveryAttester == address(0))
        {
            revert ZeroAddress();
        }
        if (initialProtocolFeeBps > MAX_PROTOCOL_FEE_BPS) revert FeeTooHigh();
        if (initialReviewTimeoutSeconds == 0) revert InvalidTimeout();

        paymentToken = initialPaymentToken;
        treasury = initialTreasury;
        protocolFeeBps = initialProtocolFeeBps;
        deliveryAttester = initialDeliveryAttester;
        reviewTimeoutSeconds = initialReviewTimeoutSeconds;
        refundGracePeriodSeconds = initialRefundGracePeriodSeconds;

        emit TreasuryUpdated(initialTreasury);
        emit ProtocolFeeBpsUpdated(initialProtocolFeeBps);
        emit DeliveryAttesterUpdated(initialDeliveryAttester);
        emit ReviewTimeoutSecondsUpdated(initialReviewTimeoutSeconds);
        emit RefundGracePeriodSecondsUpdated(initialRefundGracePeriodSeconds);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        treasury = newTreasury;
        emit TreasuryUpdated(newTreasury);
    }

    function setProtocolFeeBps(uint16 newProtocolFeeBps) external onlyOwner {
        if (newProtocolFeeBps > MAX_PROTOCOL_FEE_BPS) revert FeeTooHigh();
        protocolFeeBps = newProtocolFeeBps;
        emit ProtocolFeeBpsUpdated(newProtocolFeeBps);
    }

    function setDeliveryAttester(address newDeliveryAttester) external onlyOwner {
        if (newDeliveryAttester == address(0)) revert ZeroAddress();
        deliveryAttester = newDeliveryAttester;
        emit DeliveryAttesterUpdated(newDeliveryAttester);
    }

    function setReviewTimeoutSeconds(uint64 newReviewTimeoutSeconds) external onlyOwner {
        if (newReviewTimeoutSeconds == 0) revert InvalidTimeout();
        reviewTimeoutSeconds = newReviewTimeoutSeconds;
        emit ReviewTimeoutSecondsUpdated(newReviewTimeoutSeconds);
    }

    function setRefundGracePeriodSeconds(uint64 newRefundGracePeriodSeconds) external onlyOwner {
        refundGracePeriodSeconds = newRefundGracePeriodSeconds;
        emit RefundGracePeriodSecondsUpdated(newRefundGracePeriodSeconds);
    }
}
