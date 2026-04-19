// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract ProviderVault {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    address public immutable admin;
    address public taskCommitment;

    struct VaultState {
        uint256 totalDeposited;
        uint256 outstandingLiability;
        bool registered;
    }

    // AA wallet => vault state
    mapping(address => VaultState) public vaults;

    // Optional operator EOA => AA wallet
    mapping(address => address) public operatorToAA;

    event ProviderVaultRegistered(address indexed providerAA, address indexed operator);
    event OperatorUpdated(address indexed providerAA, address indexed oldOperator, address indexed newOperator);
    event Deposited(address indexed providerAA, uint256 amount, uint256 newTotal);
    event Withdrawn(address indexed providerAA, uint256 amount, uint256 remaining);
    event LiabilityReserved(address indexed providerAA, uint256 amount, uint256 newLiability);
    event LiabilityReleased(address indexed providerAA, uint256 amount, uint256 newLiability);
    event Slashed(address indexed providerAA, address indexed recipient, uint256 amount);
    event TaskCommitmentUpdated(address indexed newTaskCommitment);

    modifier onlyAdmin() {
        require(msg.sender == admin, "Not admin");
        _;
    }

    modifier onlyTaskCommitment() {
        require(msg.sender == taskCommitment, "Caller is not TaskCommitment");
        _;
    }

    constructor(address _token) {
        require(_token != address(0), "Zero token address");
        token = IERC20(_token);
        admin = msg.sender;
    }

    function setTaskCommitment(address _taskCommitment) external onlyAdmin {
        require(_taskCommitment != address(0), "Zero address");
        taskCommitment = _taskCommitment;
        emit TaskCommitmentUpdated(_taskCommitment);
    }

    /// @notice Register the caller as the provider's AA wallet.
    /// @param operator Optional EOA/operator allowed to act on behalf of this AA wallet for UX convenience.
    function registerVault(address operator) external {
        VaultState storage v = vaults[msg.sender];
        require(!v.registered, "Vault already registered");

        v.registered = true;

        if (operator != address(0)) {
            require(operatorToAA[operator] == address(0), "Operator already assigned");
            operatorToAA[operator] = msg.sender;
        }

        emit ProviderVaultRegistered(msg.sender, operator);
    }

    /// @notice Update or clear the operator for the caller's AA wallet.
    function setOperator(address newOperator) external {
        VaultState storage v = vaults[msg.sender];
        require(v.registered, "Vault not registered");

        address oldOperator = address(0);

        // Find current operator by scanning impossible on-chain, so we only allow replacing
        // when caller supplies a fresh operator and old operator is managed off-chain.
        // To support safe replacement, caller should first clear old operator using clearOperator.
        if (newOperator != address(0)) {
            require(operatorToAA[newOperator] == address(0), "Operator already assigned");
            operatorToAA[newOperator] = msg.sender;
        }

        emit OperatorUpdated(msg.sender, oldOperator, newOperator);
    }

    /// @notice Clear an operator mapping if the caller knows the operator address.
    function clearOperator(address operator) external {
        VaultState storage v = vaults[msg.sender];
        require(v.registered, "Vault not registered");
        require(operatorToAA[operator] == msg.sender, "Operator not mapped to caller");

        delete operatorToAA[operator];

        emit OperatorUpdated(msg.sender, operator, address(0));
    }

    function resolveProvider(address caller) public view returns (address) {
        if (vaults[caller].registered) {
            return caller; // caller is the AA wallet
        }

        address aa = operatorToAA[caller];
        require(aa != address(0) && vaults[aa].registered, "Not authorized provider");
        return aa;
    }

    function deposit(uint256 amount) external {
        require(amount > 0, "Amount must be > 0");

        address providerAA = resolveProvider(msg.sender);
        VaultState storage v = vaults[providerAA];

        token.safeTransferFrom(providerAA, address(this), amount);

        v.totalDeposited += amount;

        emit Deposited(providerAA, amount, v.totalDeposited);
    }

    function withdraw(uint256 amount) external {
        require(amount > 0, "Amount must be > 0");

        address providerAA = resolveProvider(msg.sender);
        VaultState storage v = vaults[providerAA];

        uint256 available = v.totalDeposited - v.outstandingLiability;
        require(amount <= available, "Insufficient available capacity");

        v.totalDeposited -= amount;
        token.safeTransfer(providerAA, amount);

        emit Withdrawn(providerAA, amount, v.totalDeposited);
    }

    function reserveLiability(address providerAA, uint256 amount) external onlyTaskCommitment {
        require(providerAA != address(0), "Zero provider AA");
        require(amount > 0, "Amount must be > 0");

        VaultState storage v = vaults[providerAA];
        require(v.registered, "Provider vault not registered");

        uint256 available = v.totalDeposited - v.outstandingLiability;
        require(amount <= available, "Insufficient vault capacity");

        v.outstandingLiability += amount;

        emit LiabilityReserved(providerAA, amount, v.outstandingLiability);
    }

    function releaseLiability(address providerAA, uint256 amount) external onlyTaskCommitment {
        require(providerAA != address(0), "Zero provider AA");
        require(amount > 0, "Amount must be > 0");

        VaultState storage v = vaults[providerAA];
        require(v.registered, "Provider vault not registered");
        require(v.outstandingLiability >= amount, "Liability underflow");

        v.outstandingLiability -= amount;

        emit LiabilityReleased(providerAA, amount, v.outstandingLiability);
    }

    function slash(address providerAA, uint256 amount, address recipient) external onlyTaskCommitment {
        require(providerAA != address(0), "Zero provider AA");
        require(recipient != address(0), "Zero recipient");
        require(amount > 0, "Amount must be > 0");

        VaultState storage v = vaults[providerAA];
        require(v.registered, "Provider vault not registered");
        require(v.outstandingLiability >= amount, "Liability underflow");
        require(v.totalDeposited >= amount, "Deposit underflow");

        v.outstandingLiability -= amount;
        v.totalDeposited -= amount;

        token.safeTransfer(recipient, amount);

        emit Slashed(providerAA, recipient, amount);
    }

    function availableCapacity(address providerAA) external view returns (uint256) {
        VaultState storage v = vaults[providerAA];
        require(v.registered, "Provider vault not registered");
        return v.totalDeposited - v.outstandingLiability;
    }

    function getVaultState(address providerAA)
        external
        view
        returns (
            uint256 totalDeposited,
            uint256 outstandingLiability,
            uint256 available,
            bool registered
        )
    {
        VaultState storage v = vaults[providerAA];

        return (
            v.totalDeposited,
            v.outstandingLiability,
            v.totalDeposited - v.outstandingLiability,
            v.registered
        );
    }
}