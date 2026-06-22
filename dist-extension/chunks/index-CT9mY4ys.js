import { a as abstract, b as abstractTestnet, z as zksyncSepoliaTestnet, c as zksync, h as hashBytecode } from "./index-DR1_HPFH.js";
import { B as BaseError, r as assertRequest, t as toBytes, u as keccak256, v as toHex, w as parseAccount, i as isHex, x as fromHex, y as getAction, z as getCode, A as encodeFunctionData, h as concat, j as encodeAbiParameters, C as getAbiItem, D as getAddress, E as sendTransaction$1, p as concatHex, F as readContract, G as AbiConstructorNotFoundError, J as AbiConstructorParamsNotFoundError, K as sendRawTransactionSync, L as decodeFunctionData, M as decodeAbiParameters, N as toFunctionSelector, O as getChainId, P as assertCurrentChain, Q as signTypedData$1, R as parseAbiParameters, S as zeroAddress, T as hashTypedData, U as getContractError, V as http, W as createPublicClient, X as toAccount, Y as createClient, Z as createWalletClient, _ as getBalance, $ as getTransactionCount, a0 as getGasPrice, a1 as estimateGas, a2 as RpcRequestError, a3 as ExecutionRevertedError, a4 as sendRawTransaction, a5 as getTransactionError, a6 as InvalidParameterError, a7 as getTransactionReceipt, a8 as TransactionReceiptNotFoundError, a9 as UnsupportedChainIdError, aa as isAddress, ab as InvalidAddressError, ac as writeContract$1, ad as UnsupportedNonOptionalCapabilityError, ae as bytesToString, af as hashMessage } from "../background.js";
import { z as zeroHash, s as serializeErc6492Signature, f as fromRlp, c as custom } from "./custom-BLL-GDtV.js";
const AccountFactoryAbi = [
  {
    inputs: [
      {
        internalType: "address",
        name: "_implementation",
        type: "address"
      },
      {
        internalType: "bytes4",
        name: "_initializerSelector",
        type: "bytes4"
      },
      {
        internalType: "address",
        name: "_registry",
        type: "address"
      },
      {
        internalType: "bytes32",
        name: "_proxyBytecodeHash",
        type: "bytes32"
      },
      {
        internalType: "address",
        name: "_deployer",
        type: "address"
      },
      {
        internalType: "address",
        name: "_owner",
        type: "address"
      }
    ],
    stateMutability: "nonpayable",
    type: "constructor"
  },
  {
    inputs: [],
    name: "ALREADY_CREATED",
    type: "error"
  },
  {
    inputs: [],
    name: "DEPLOYMENT_FAILED",
    type: "error"
  },
  {
    inputs: [],
    name: "INVALID_INITIALIZER",
    type: "error"
  },
  {
    inputs: [],
    name: "NOT_FROM_DEPLOYER",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "owner",
        type: "address"
      }
    ],
    name: "OwnableInvalidOwner",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "OwnableUnauthorizedAccount",
    type: "error"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "accountAddress",
        type: "address"
      }
    ],
    name: "AGWAccountCreated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "accountAddress",
        type: "address"
      }
    ],
    name: "AGWAccountDeployed",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "deployer",
        type: "address"
      },
      {
        indexed: true,
        internalType: "bool",
        name: "authorized",
        type: "bool"
      }
    ],
    name: "DeployerAuthorized",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "newImplementation",
        type: "address"
      }
    ],
    name: "ImplementationChanged",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "previousOwner",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "newOwner",
        type: "address"
      }
    ],
    name: "OwnershipTransferStarted",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "previousOwner",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "newOwner",
        type: "address"
      }
    ],
    name: "OwnershipTransferred",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "newRegistry",
        type: "address"
      }
    ],
    name: "RegistryChanged",
    type: "event"
  },
  {
    inputs: [],
    name: "acceptOwnership",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "accountToDeployer",
    outputs: [
      {
        internalType: "address",
        name: "deployer",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "accountAddress",
        type: "address"
      }
    ],
    name: "agwAccountCreated",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "deployer",
        type: "address"
      }
    ],
    name: "authorizedDeployers",
    outputs: [
      {
        internalType: "bool",
        name: "authorized",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "newImplementation",
        type: "address"
      },
      {
        internalType: "bytes4",
        name: "newInitializerSelector",
        type: "bytes4"
      }
    ],
    name: "changeImplementation",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "newRegistry",
        type: "address"
      }
    ],
    name: "changeRegistry",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "salt",
        type: "bytes32"
      },
      {
        internalType: "bytes",
        name: "initializer",
        type: "bytes"
      }
    ],
    name: "deployAccount",
    outputs: [
      {
        internalType: "address",
        name: "accountAddress",
        type: "address"
      }
    ],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "salt",
        type: "bytes32"
      }
    ],
    name: "getAddressForSalt",
    outputs: [
      {
        internalType: "address",
        name: "accountAddress",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "salt",
        type: "bytes32"
      },
      {
        internalType: "address",
        name: "_implementation",
        type: "address"
      }
    ],
    name: "getAddressForSaltAndImplementation",
    outputs: [
      {
        internalType: "address",
        name: "accountAddress",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "implementationAddress",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "initializerSelector",
    outputs: [
      {
        internalType: "bytes4",
        name: "",
        type: "bytes4"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "owner",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "pendingOwner",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "proxyBytecodeHash",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "registry",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "renounceOwnership",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "salt",
        type: "bytes32"
      }
    ],
    name: "saltToAccount",
    outputs: [
      {
        internalType: "address",
        name: "accountAddress",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "deployer",
        type: "address"
      },
      {
        internalType: "bool",
        name: "authorized",
        type: "bool"
      }
    ],
    name: "setDeployer",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "newOwner",
        type: "address"
      }
    ],
    name: "transferOwnership",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  }
];
const SMART_ACCOUNT_FACTORY_ADDRESS = "0x9B947df68D35281C972511B3E7BC875926f26C1A";
const EOA_VALIDATOR_ADDRESS = "0x74b9ae28EC45E3FA11533c7954752597C3De3e7A";
const SESSION_KEY_VALIDATOR_ADDRESS = "0x34ca1501FAE231cC2ebc995CE013Dbe882d7d081";
const CONTRACT_DEPLOYER_ADDRESS = "0x0000000000000000000000000000000000008006";
const ADD_MODULE_SELECTOR = "0xd3bdf4b5";
const CREATE_SESSION_SELECTOR = "0x5a0694d2";
const BATCH_CALL_SELECTOR = "0x8f0273a9";
const INSUFFICIENT_BALANCE_SELECTOR = "0xe7931438";
const CANONICAL_EXCLUSIVE_DELEGATE_RESOLVER_ADDRESS = "0x0000000078CC4Cc1C14E27c0fa35ED6E5E58825D";
const AGW_LINK_DELEGATION_RIGHTS = "0xc10dcfe266c1f71ef476efbd3223555750dc271e4115626b";
({
  [abstractTestnet.id]: "0x35A54c8C757806eB6820629bc82d90E056394C92",
  [abstract.id]: "0x303a465b659cbb0ab36ee643ea362c509eeb5213"
});
const SESSION_KEY_POLICY_REGISTRY_ADDRESS = "0xfD20b9d7A406e2C4f5D6Df71ABE3Ee48B2EccC9F";
class InvalidEip712TransactionError extends BaseError {
  constructor() {
    super([
      "Transaction is not an EIP712 transaction.",
      "",
      "Transaction must:",
      '  - include `type: "eip712"`',
      "  - include one of the following: `customSignature`, `paymaster`, `paymasterInput`, `gasPerPubdata`, `factoryDeps`"
    ].join("\n"), { name: "InvalidEip712TransactionError" });
  }
}
function isEIP712Transaction(transaction) {
  if (transaction.type === "eip712")
    return true;
  if ("customSignature" in transaction && transaction.customSignature || "paymaster" in transaction && transaction.paymaster || "paymasterInput" in transaction && transaction.paymasterInput || "gasPerPubdata" in transaction && typeof transaction.gasPerPubdata === "bigint" || "factoryDeps" in transaction && transaction.factoryDeps)
    return true;
  return false;
}
function assertEip712Request(args) {
  if (!isEIP712Transaction(args))
    throw new InvalidEip712TransactionError();
  assertRequest(args);
}
const VALID_CHAINS = {
  [abstractTestnet.id]: abstractTestnet,
  [abstract.id]: abstract,
  [zksync.id]: zksync,
  [zksyncSepoliaTestnet.id]: zksyncSepoliaTestnet
};
async function getSmartAccountAddressFromInitialSigner(initialSigner, publicClient) {
  if (initialSigner === void 0) {
    throw new Error("Initial signer is required to get smart account address");
  }
  const addressBytes = toBytes(initialSigner);
  const salt = keccak256(addressBytes);
  const accountAddress = await publicClient.readContract({
    address: SMART_ACCOUNT_FACTORY_ADDRESS,
    abi: AccountFactoryAbi,
    functionName: "getAddressForSalt",
    args: [salt]
  });
  return accountAddress;
}
async function isSmartAccountDeployed(client, address) {
  const bytecode = await getAction(client, getCode, "getCode")({
    address
  });
  return bytecode !== void 0;
}
function getInitializerCalldata(initialOwnerAddress, validatorAddress, initialCall) {
  return encodeFunctionData({
    abi: [
      {
        name: "initialize",
        type: "function",
        inputs: [
          { name: "initialK1Owner", type: "address" },
          { name: "initialK1Validator", type: "address" },
          { name: "modules", type: "bytes[]" },
          {
            name: "initCall",
            type: "tuple",
            components: [
              { name: "target", type: "address" },
              { name: "allowFailure", type: "bool" },
              { name: "value", type: "uint256" },
              { name: "callData", type: "bytes" }
            ]
          }
        ],
        outputs: [],
        stateMutability: "nonpayable"
      }
    ],
    functionName: "initialize",
    args: [initialOwnerAddress, validatorAddress, [], initialCall]
  });
}
function transformHexValues(transaction, keys) {
  if (!transaction)
    return;
  for (const key of keys) {
    if (isHex(transaction[key])) {
      transaction[key] = fromHex(transaction[key], "bigint");
    }
  }
}
function isEip712TypedData(typedData) {
  var _a, _b;
  return typedData.message && ((_a = typedData.domain) == null ? void 0 : _a.name) === "zkSync" && ((_b = typedData.domain) == null ? void 0 : _b.version) === "2" && isEIP712Transaction(typedData.message);
}
function transformEip712TypedData(typedData) {
  var _a;
  if (!isEip712TypedData(typedData)) {
    throw new BaseError("Typed data is not an EIP712 transaction");
  }
  if (((_a = typedData.domain) == null ? void 0 : _a.chainId) === void 0) {
    throw new BaseError("Chain ID is required for EIP712 transaction");
  }
  return {
    chainId: Number(typedData.domain.chainId),
    account: parseAccount(toHex(BigInt(typedData.message.from), {
      size: 20
    })),
    to: toHex(BigInt(typedData.message.to), {
      size: 20
    }),
    gas: BigInt(typedData.message.gasLimit),
    gasPerPubdata: BigInt(typedData.message.gasPerPubdataByteLimit),
    maxFeePerGas: BigInt(typedData.message.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(typedData.message.maxPriorityFeePerGas),
    paymaster: typedData.message.paymaster !== "0" ? toHex(BigInt(typedData.message.paymaster), {
      size: 20
    }) : void 0,
    nonce: typedData.message.nonce,
    value: BigInt(typedData.message.value),
    data: typedData.message.data === "0x0" ? "0x" : typedData.message.data,
    factoryDeps: typedData.message.factoryDeps,
    paymasterInput: typedData.message.paymasterInput !== "0x" ? typedData.message.paymasterInput : void 0
  };
}
function encodeCall(call_) {
  const call = call_;
  const data = call.abi ? encodeFunctionData({
    abi: call.abi,
    functionName: call.functionName,
    args: call.args
  }) : call.data;
  return {
    data: call.dataSuffix && data ? concat([data, call.dataSuffix]) : data,
    to: call.to,
    value: call.value
  };
}
function encodeCalls(calls) {
  return calls.map(encodeCall);
}
function formatCalls(calls) {
  return calls.map((call_) => {
    const call = encodeCall(call_);
    return {
      callData: call.data ?? "0x",
      target: call.to,
      value: call.value ?? 0n,
      allowFailure: false
    };
  });
}
const AGWAccountAbi = [
  {
    inputs: [],
    stateMutability: "nonpayable",
    type: "constructor"
  },
  {
    inputs: [],
    name: "ADDRESS_ALREADY_EXISTS",
    type: "error"
  },
  {
    inputs: [],
    name: "ADDRESS_NOT_EXISTS",
    type: "error"
  },
  {
    inputs: [],
    name: "BYTES_ALREADY_EXISTS",
    type: "error"
  },
  {
    inputs: [],
    name: "BYTES_NOT_EXISTS",
    type: "error"
  },
  {
    inputs: [],
    name: "CALL_FAILED",
    type: "error"
  },
  {
    inputs: [],
    name: "EMPTY_HOOK_ADDRESS",
    type: "error"
  },
  {
    inputs: [],
    name: "EMPTY_MODULE_ADDRESS",
    type: "error"
  },
  {
    inputs: [],
    name: "EMPTY_OWNERS",
    type: "error"
  },
  {
    inputs: [],
    name: "EMPTY_VALIDATORS",
    type: "error"
  },
  {
    inputs: [],
    name: "FEE_PAYMENT_FAILED",
    type: "error"
  },
  {
    inputs: [],
    name: "HOOK_ERC165_FAIL",
    type: "error"
  },
  {
    inputs: [],
    name: "INSUFFICIENT_FUNDS",
    type: "error"
  },
  {
    inputs: [],
    name: "INVALID_ADDRESS",
    type: "error"
  },
  {
    inputs: [],
    name: "INVALID_BYTES",
    type: "error"
  },
  {
    inputs: [],
    name: "INVALID_KEY",
    type: "error"
  },
  {
    inputs: [],
    name: "INVALID_PUBKEY_LENGTH",
    type: "error"
  },
  {
    inputs: [],
    name: "INVALID_SALT",
    type: "error"
  },
  {
    inputs: [],
    name: "InvalidInitialization",
    type: "error"
  },
  {
    inputs: [],
    name: "MODULE_ERC165_FAIL",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "actualValue",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "expectedValue",
        type: "uint256"
      }
    ],
    name: "MsgValueMismatch",
    type: "error"
  },
  {
    inputs: [],
    name: "NOT_FROM_BOOTLOADER",
    type: "error"
  },
  {
    inputs: [],
    name: "NOT_FROM_DEPLOYER",
    type: "error"
  },
  {
    inputs: [],
    name: "NOT_FROM_HOOK",
    type: "error"
  },
  {
    inputs: [],
    name: "NOT_FROM_MODULE",
    type: "error"
  },
  {
    inputs: [],
    name: "NOT_FROM_SELF",
    type: "error"
  },
  {
    inputs: [],
    name: "NOT_FROM_SELF_OR_MODULE",
    type: "error"
  },
  {
    inputs: [],
    name: "NotInitializing",
    type: "error"
  },
  {
    inputs: [],
    name: "RECUSIVE_MODULE_CALL",
    type: "error"
  },
  {
    inputs: [],
    name: "SAME_IMPLEMENTATION",
    type: "error"
  },
  {
    inputs: [],
    name: "UNAUTHORIZED_OUTSIDE_TRANSACTION",
    type: "error"
  },
  {
    inputs: [],
    name: "VALIDATION_HOOK_FAILED",
    type: "error"
  },
  {
    inputs: [],
    name: "VALIDATOR_ERC165_FAIL",
    type: "error"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "hook",
        type: "address"
      }
    ],
    name: "AddHook",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "module",
        type: "address"
      }
    ],
    name: "AddModule",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "validator",
        type: "address"
      }
    ],
    name: "AddModuleValidator",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [],
    name: "EIP712DomainChanged",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [],
    name: "FeePaid",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint64",
        name: "version",
        type: "uint64"
      }
    ],
    name: "Initialized",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "addr",
        type: "address"
      }
    ],
    name: "K1AddOwner",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "validator",
        type: "address"
      }
    ],
    name: "K1AddValidator",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "addr",
        type: "address"
      }
    ],
    name: "K1RemoveOwner",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "validator",
        type: "address"
      }
    ],
    name: "K1RemoveValidator",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "bytes",
        name: "pubKey",
        type: "bytes"
      }
    ],
    name: "R1AddOwner",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "validator",
        type: "address"
      }
    ],
    name: "R1AddValidator",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "bytes",
        name: "pubKey",
        type: "bytes"
      }
    ],
    name: "R1RemoveOwner",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "validator",
        type: "address"
      }
    ],
    name: "R1RemoveValidator",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "hook",
        type: "address"
      }
    ],
    name: "RemoveHook",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "module",
        type: "address"
      }
    ],
    name: "RemoveModule",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "validator",
        type: "address"
      }
    ],
    name: "RemoveModuleValidator",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [],
    name: "ResetOwners",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "oldImplementation",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "newImplementation",
        type: "address"
      }
    ],
    name: "Upgraded",
    type: "event"
  },
  {
    stateMutability: "payable",
    type: "fallback"
  },
  {
    inputs: [],
    name: "VERSION",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes",
        name: "hookAndData",
        type: "bytes"
      },
      {
        internalType: "bool",
        name: "isValidation",
        type: "bool"
      }
    ],
    name: "addHook",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes",
        name: "moduleAndData",
        type: "bytes"
      }
    ],
    name: "addModule",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "validator",
        type: "address"
      },
      {
        internalType: "bytes",
        name: "initialAccountValidationKey",
        type: "bytes"
      }
    ],
    name: "addModuleValidator",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        components: [
          {
            internalType: "address",
            name: "target",
            type: "address"
          },
          {
            internalType: "bool",
            name: "allowFailure",
            type: "bool"
          },
          {
            internalType: "uint256",
            name: "value",
            type: "uint256"
          },
          {
            internalType: "bytes",
            name: "callData",
            type: "bytes"
          }
        ],
        internalType: "struct Call[]",
        name: "_calls",
        type: "tuple[]"
      }
    ],
    name: "batchCall",
    outputs: [],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [],
    name: "agwMessageTypeHash",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "pure",
    type: "function"
  },
  {
    inputs: [
      {
        components: [
          {
            internalType: "address",
            name: "target",
            type: "address"
          },
          {
            internalType: "bool",
            name: "allowFailure",
            type: "bool"
          },
          {
            internalType: "uint256",
            name: "value",
            type: "uint256"
          },
          {
            internalType: "bytes",
            name: "callData",
            type: "bytes"
          }
        ],
        internalType: "struct Call[]",
        name: "_calls",
        type: "tuple[]"
      }
    ],
    name: "batchCall",
    outputs: [],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [],
    name: "eip712Domain",
    outputs: [
      {
        internalType: "bytes1",
        name: "fields",
        type: "bytes1"
      },
      {
        internalType: "string",
        name: "name",
        type: "string"
      },
      {
        internalType: "string",
        name: "version",
        type: "string"
      },
      {
        internalType: "uint256",
        name: "chainId",
        type: "uint256"
      },
      {
        internalType: "address",
        name: "verifyingContract",
        type: "address"
      },
      {
        internalType: "bytes32",
        name: "salt",
        type: "bytes32"
      },
      {
        internalType: "uint256[]",
        name: "extensions",
        type: "uint256[]"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "to",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "value",
        type: "uint256"
      },
      {
        internalType: "bytes",
        name: "data",
        type: "bytes"
      }
    ],
    name: "executeFromModule",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      },
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      },
      {
        components: [
          {
            internalType: "uint256",
            name: "txType",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "from",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "to",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "gasLimit",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "gasPerPubdataByteLimit",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "maxFeePerGas",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "maxPriorityFeePerGas",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "paymaster",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "nonce",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "value",
            type: "uint256"
          },
          {
            internalType: "uint256[4]",
            name: "reserved",
            type: "uint256[4]"
          },
          {
            internalType: "bytes",
            name: "data",
            type: "bytes"
          },
          {
            internalType: "bytes",
            name: "signature",
            type: "bytes"
          },
          {
            internalType: "bytes32[]",
            name: "factoryDeps",
            type: "bytes32[]"
          },
          {
            internalType: "bytes",
            name: "paymasterInput",
            type: "bytes"
          },
          {
            internalType: "bytes",
            name: "reservedDynamic",
            type: "bytes"
          }
        ],
        internalType: "struct Transaction",
        name: "transaction",
        type: "tuple"
      }
    ],
    name: "executeTransaction",
    outputs: [],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [
      {
        components: [
          {
            internalType: "uint256",
            name: "txType",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "from",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "to",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "gasLimit",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "gasPerPubdataByteLimit",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "maxFeePerGas",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "maxPriorityFeePerGas",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "paymaster",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "nonce",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "value",
            type: "uint256"
          },
          {
            internalType: "uint256[4]",
            name: "reserved",
            type: "uint256[4]"
          },
          {
            internalType: "bytes",
            name: "data",
            type: "bytes"
          },
          {
            internalType: "bytes",
            name: "signature",
            type: "bytes"
          },
          {
            internalType: "bytes32[]",
            name: "factoryDeps",
            type: "bytes32[]"
          },
          {
            internalType: "bytes",
            name: "paymasterInput",
            type: "bytes"
          },
          {
            internalType: "bytes",
            name: "reservedDynamic",
            type: "bytes"
          }
        ],
        internalType: "struct Transaction",
        name: "transaction",
        type: "tuple"
      }
    ],
    name: "executeTransactionFromOutside",
    outputs: [],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [
      {
        components: [
          {
            internalType: "bytes32",
            name: "signedHash",
            type: "bytes32"
          }
        ],
        internalType: "struct ERC1271Handler.AGWMessage",
        name: "agwMessage",
        type: "tuple"
      }
    ],
    name: "getEip712Hash",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "hook",
        type: "address"
      },
      {
        internalType: "bytes32",
        name: "key",
        type: "bytes32"
      }
    ],
    name: "getHookData",
    outputs: [
      {
        internalType: "bytes",
        name: "",
        type: "bytes"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "implementationAddress",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "initialK1Owner",
        type: "address"
      },
      {
        internalType: "address",
        name: "initialK1Validator",
        type: "address"
      },
      {
        internalType: "bytes[]",
        name: "modules",
        type: "bytes[]"
      },
      {
        components: [
          {
            internalType: "address",
            name: "target",
            type: "address"
          },
          {
            internalType: "bool",
            name: "allowFailure",
            type: "bool"
          },
          {
            internalType: "uint256",
            name: "value",
            type: "uint256"
          },
          {
            internalType: "bytes",
            name: "callData",
            type: "bytes"
          }
        ],
        internalType: "struct Call",
        name: "initCall",
        type: "tuple"
      }
    ],
    name: "initialize",
    outputs: [],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "addr",
        type: "address"
      }
    ],
    name: "isHook",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "addr",
        type: "address"
      }
    ],
    name: "isModule",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "validator",
        type: "address"
      }
    ],
    name: "isModuleValidator",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "signedHash",
        type: "bytes32"
      },
      {
        internalType: "bytes",
        name: "signatureAndValidator",
        type: "bytes"
      }
    ],
    name: "isValidSignature",
    outputs: [
      {
        internalType: "bytes4",
        name: "magicValue",
        type: "bytes4"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "addr",
        type: "address"
      }
    ],
    name: "k1AddOwner",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "validator",
        type: "address"
      }
    ],
    name: "k1AddValidator",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "addr",
        type: "address"
      }
    ],
    name: "k1IsOwner",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "validator",
        type: "address"
      }
    ],
    name: "k1IsValidator",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "k1ListOwners",
    outputs: [
      {
        internalType: "address[]",
        name: "k1OwnerList",
        type: "address[]"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "k1ListValidators",
    outputs: [
      {
        internalType: "address[]",
        name: "validatorList",
        type: "address[]"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "addr",
        type: "address"
      }
    ],
    name: "k1RemoveOwner",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "validator",
        type: "address"
      }
    ],
    name: "k1RemoveValidator",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bool",
        name: "isValidation",
        type: "bool"
      }
    ],
    name: "listHooks",
    outputs: [
      {
        internalType: "address[]",
        name: "hookList",
        type: "address[]"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "listModuleValidators",
    outputs: [
      {
        internalType: "address[]",
        name: "validatorList",
        type: "address[]"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "listModules",
    outputs: [
      {
        internalType: "address[]",
        name: "moduleList",
        type: "address[]"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      },
      {
        internalType: "address",
        name: "",
        type: "address"
      },
      {
        internalType: "uint256[]",
        name: "",
        type: "uint256[]"
      },
      {
        internalType: "uint256[]",
        name: "",
        type: "uint256[]"
      },
      {
        internalType: "bytes",
        name: "",
        type: "bytes"
      }
    ],
    name: "onERC1155BatchReceived",
    outputs: [
      {
        internalType: "bytes4",
        name: "",
        type: "bytes4"
      }
    ],
    stateMutability: "pure",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      },
      {
        internalType: "address",
        name: "",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      },
      {
        internalType: "bytes",
        name: "",
        type: "bytes"
      }
    ],
    name: "onERC1155Received",
    outputs: [
      {
        internalType: "bytes4",
        name: "",
        type: "bytes4"
      }
    ],
    stateMutability: "pure",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      },
      {
        internalType: "address",
        name: "",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      },
      {
        internalType: "bytes",
        name: "",
        type: "bytes"
      }
    ],
    name: "onERC721Received",
    outputs: [
      {
        internalType: "bytes4",
        name: "",
        type: "bytes4"
      }
    ],
    stateMutability: "pure",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      },
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      },
      {
        components: [
          {
            internalType: "uint256",
            name: "txType",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "from",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "to",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "gasLimit",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "gasPerPubdataByteLimit",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "maxFeePerGas",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "maxPriorityFeePerGas",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "paymaster",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "nonce",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "value",
            type: "uint256"
          },
          {
            internalType: "uint256[4]",
            name: "reserved",
            type: "uint256[4]"
          },
          {
            internalType: "bytes",
            name: "data",
            type: "bytes"
          },
          {
            internalType: "bytes",
            name: "signature",
            type: "bytes"
          },
          {
            internalType: "bytes32[]",
            name: "factoryDeps",
            type: "bytes32[]"
          },
          {
            internalType: "bytes",
            name: "paymasterInput",
            type: "bytes"
          },
          {
            internalType: "bytes",
            name: "reservedDynamic",
            type: "bytes"
          }
        ],
        internalType: "struct Transaction",
        name: "transaction",
        type: "tuple"
      }
    ],
    name: "payForTransaction",
    outputs: [],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      },
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      },
      {
        components: [
          {
            internalType: "uint256",
            name: "txType",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "from",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "to",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "gasLimit",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "gasPerPubdataByteLimit",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "maxFeePerGas",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "maxPriorityFeePerGas",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "paymaster",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "nonce",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "value",
            type: "uint256"
          },
          {
            internalType: "uint256[4]",
            name: "reserved",
            type: "uint256[4]"
          },
          {
            internalType: "bytes",
            name: "data",
            type: "bytes"
          },
          {
            internalType: "bytes",
            name: "signature",
            type: "bytes"
          },
          {
            internalType: "bytes32[]",
            name: "factoryDeps",
            type: "bytes32[]"
          },
          {
            internalType: "bytes",
            name: "paymasterInput",
            type: "bytes"
          },
          {
            internalType: "bytes",
            name: "reservedDynamic",
            type: "bytes"
          }
        ],
        internalType: "struct Transaction",
        name: "transaction",
        type: "tuple"
      }
    ],
    name: "prepareForPaymaster",
    outputs: [],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes",
        name: "pubKey",
        type: "bytes"
      }
    ],
    name: "r1AddOwner",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "validator",
        type: "address"
      }
    ],
    name: "r1AddValidator",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes",
        name: "pubKey",
        type: "bytes"
      }
    ],
    name: "r1IsOwner",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "validator",
        type: "address"
      }
    ],
    name: "r1IsValidator",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "r1ListOwners",
    outputs: [
      {
        internalType: "bytes[]",
        name: "r1OwnerList",
        type: "bytes[]"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "r1ListValidators",
    outputs: [
      {
        internalType: "address[]",
        name: "validatorList",
        type: "address[]"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes",
        name: "pubKey",
        type: "bytes"
      }
    ],
    name: "r1RemoveOwner",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "validator",
        type: "address"
      }
    ],
    name: "r1RemoveValidator",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "hook",
        type: "address"
      },
      {
        internalType: "bool",
        name: "isValidation",
        type: "bool"
      }
    ],
    name: "removeHook",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "module",
        type: "address"
      }
    ],
    name: "removeModule",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "validator",
        type: "address"
      }
    ],
    name: "removeModuleValidator",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes",
        name: "pubKey",
        type: "bytes"
      }
    ],
    name: "resetOwners",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "key",
        type: "bytes32"
      },
      {
        internalType: "bytes",
        name: "data",
        type: "bytes"
      }
    ],
    name: "setHookData",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes4",
        name: "interfaceId",
        type: "bytes4"
      }
    ],
    name: "supportsInterface",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "newImplementation",
        type: "address"
      }
    ],
    name: "upgradeTo",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      },
      {
        internalType: "bytes32",
        name: "suggestedSignedHash",
        type: "bytes32"
      },
      {
        components: [
          {
            internalType: "uint256",
            name: "txType",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "from",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "to",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "gasLimit",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "gasPerPubdataByteLimit",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "maxFeePerGas",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "maxPriorityFeePerGas",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "paymaster",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "nonce",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "value",
            type: "uint256"
          },
          {
            internalType: "uint256[4]",
            name: "reserved",
            type: "uint256[4]"
          },
          {
            internalType: "bytes",
            name: "data",
            type: "bytes"
          },
          {
            internalType: "bytes",
            name: "signature",
            type: "bytes"
          },
          {
            internalType: "bytes32[]",
            name: "factoryDeps",
            type: "bytes32[]"
          },
          {
            internalType: "bytes",
            name: "paymasterInput",
            type: "bytes"
          },
          {
            internalType: "bytes",
            name: "reservedDynamic",
            type: "bytes"
          }
        ],
        internalType: "struct Transaction",
        name: "transaction",
        type: "tuple"
      }
    ],
    name: "validateTransaction",
    outputs: [
      {
        internalType: "bytes4",
        name: "magic",
        type: "bytes4"
      }
    ],
    stateMutability: "payable",
    type: "function"
  },
  {
    stateMutability: "payable",
    type: "receive"
  }
];
const SessionKeyValidatorAbi = [
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "Disabled",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "Inited",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "account",
        type: "address"
      },
      {
        indexed: true,
        internalType: "bytes32",
        name: "sessionHash",
        type: "bytes32"
      },
      {
        components: [
          {
            internalType: "address",
            name: "signer",
            type: "address"
          },
          {
            internalType: "uint256",
            name: "expiresAt",
            type: "uint256"
          },
          {
            components: [
              {
                internalType: "enum SessionLib.LimitType",
                name: "limitType",
                type: "uint8"
              },
              {
                internalType: "uint256",
                name: "limit",
                type: "uint256"
              },
              {
                internalType: "uint256",
                name: "period",
                type: "uint256"
              }
            ],
            internalType: "struct SessionLib.UsageLimit",
            name: "feeLimit",
            type: "tuple"
          },
          {
            components: [
              {
                internalType: "address",
                name: "target",
                type: "address"
              },
              {
                internalType: "bytes4",
                name: "selector",
                type: "bytes4"
              },
              {
                internalType: "uint256",
                name: "maxValuePerUse",
                type: "uint256"
              },
              {
                components: [
                  {
                    internalType: "enum SessionLib.LimitType",
                    name: "limitType",
                    type: "uint8"
                  },
                  {
                    internalType: "uint256",
                    name: "limit",
                    type: "uint256"
                  },
                  {
                    internalType: "uint256",
                    name: "period",
                    type: "uint256"
                  }
                ],
                internalType: "struct SessionLib.UsageLimit",
                name: "valueLimit",
                type: "tuple"
              },
              {
                components: [
                  {
                    internalType: "enum SessionLib.Condition",
                    name: "condition",
                    type: "uint8"
                  },
                  {
                    internalType: "uint64",
                    name: "index",
                    type: "uint64"
                  },
                  {
                    internalType: "bytes32",
                    name: "refValue",
                    type: "bytes32"
                  },
                  {
                    components: [
                      {
                        internalType: "enum SessionLib.LimitType",
                        name: "limitType",
                        type: "uint8"
                      },
                      {
                        internalType: "uint256",
                        name: "limit",
                        type: "uint256"
                      },
                      {
                        internalType: "uint256",
                        name: "period",
                        type: "uint256"
                      }
                    ],
                    internalType: "struct SessionLib.UsageLimit",
                    name: "limit",
                    type: "tuple"
                  }
                ],
                internalType: "struct SessionLib.Constraint[]",
                name: "constraints",
                type: "tuple[]"
              }
            ],
            internalType: "struct SessionLib.CallSpec[]",
            name: "callPolicies",
            type: "tuple[]"
          },
          {
            components: [
              {
                internalType: "address",
                name: "target",
                type: "address"
              },
              {
                internalType: "uint256",
                name: "maxValuePerUse",
                type: "uint256"
              },
              {
                components: [
                  {
                    internalType: "enum SessionLib.LimitType",
                    name: "limitType",
                    type: "uint8"
                  },
                  {
                    internalType: "uint256",
                    name: "limit",
                    type: "uint256"
                  },
                  {
                    internalType: "uint256",
                    name: "period",
                    type: "uint256"
                  }
                ],
                internalType: "struct SessionLib.UsageLimit",
                name: "valueLimit",
                type: "tuple"
              }
            ],
            internalType: "struct SessionLib.TransferSpec[]",
            name: "transferPolicies",
            type: "tuple[]"
          }
        ],
        indexed: false,
        internalType: "struct SessionLib.SessionSpec",
        name: "sessionSpec",
        type: "tuple"
      }
    ],
    name: "SessionCreated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "account",
        type: "address"
      },
      {
        indexed: true,
        internalType: "bytes32",
        name: "sessionHash",
        type: "bytes32"
      }
    ],
    name: "SessionRevoked",
    type: "event"
  },
  {
    inputs: [
      {
        internalType: "bytes",
        name: "sessionData",
        type: "bytes"
      }
    ],
    name: "addValidationKey",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        components: [
          {
            internalType: "address",
            name: "signer",
            type: "address"
          },
          {
            internalType: "uint256",
            name: "expiresAt",
            type: "uint256"
          },
          {
            components: [
              {
                internalType: "enum SessionLib.LimitType",
                name: "limitType",
                type: "uint8"
              },
              {
                internalType: "uint256",
                name: "limit",
                type: "uint256"
              },
              {
                internalType: "uint256",
                name: "period",
                type: "uint256"
              }
            ],
            internalType: "struct SessionLib.UsageLimit",
            name: "feeLimit",
            type: "tuple"
          },
          {
            components: [
              {
                internalType: "address",
                name: "target",
                type: "address"
              },
              {
                internalType: "bytes4",
                name: "selector",
                type: "bytes4"
              },
              {
                internalType: "uint256",
                name: "maxValuePerUse",
                type: "uint256"
              },
              {
                components: [
                  {
                    internalType: "enum SessionLib.LimitType",
                    name: "limitType",
                    type: "uint8"
                  },
                  {
                    internalType: "uint256",
                    name: "limit",
                    type: "uint256"
                  },
                  {
                    internalType: "uint256",
                    name: "period",
                    type: "uint256"
                  }
                ],
                internalType: "struct SessionLib.UsageLimit",
                name: "valueLimit",
                type: "tuple"
              },
              {
                components: [
                  {
                    internalType: "enum SessionLib.Condition",
                    name: "condition",
                    type: "uint8"
                  },
                  {
                    internalType: "uint64",
                    name: "index",
                    type: "uint64"
                  },
                  {
                    internalType: "bytes32",
                    name: "refValue",
                    type: "bytes32"
                  },
                  {
                    components: [
                      {
                        internalType: "enum SessionLib.LimitType",
                        name: "limitType",
                        type: "uint8"
                      },
                      {
                        internalType: "uint256",
                        name: "limit",
                        type: "uint256"
                      },
                      {
                        internalType: "uint256",
                        name: "period",
                        type: "uint256"
                      }
                    ],
                    internalType: "struct SessionLib.UsageLimit",
                    name: "limit",
                    type: "tuple"
                  }
                ],
                internalType: "struct SessionLib.Constraint[]",
                name: "constraints",
                type: "tuple[]"
              }
            ],
            internalType: "struct SessionLib.CallSpec[]",
            name: "callPolicies",
            type: "tuple[]"
          },
          {
            components: [
              {
                internalType: "address",
                name: "target",
                type: "address"
              },
              {
                internalType: "uint256",
                name: "maxValuePerUse",
                type: "uint256"
              },
              {
                components: [
                  {
                    internalType: "enum SessionLib.LimitType",
                    name: "limitType",
                    type: "uint8"
                  },
                  {
                    internalType: "uint256",
                    name: "limit",
                    type: "uint256"
                  },
                  {
                    internalType: "uint256",
                    name: "period",
                    type: "uint256"
                  }
                ],
                internalType: "struct SessionLib.UsageLimit",
                name: "valueLimit",
                type: "tuple"
              }
            ],
            internalType: "struct SessionLib.TransferSpec[]",
            name: "transferPolicies",
            type: "tuple[]"
          }
        ],
        internalType: "struct SessionLib.SessionSpec",
        name: "sessionSpec",
        type: "tuple"
      }
    ],
    name: "createSession",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "disable",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "enum OperationType",
        name: "operationType",
        type: "uint8"
      },
      {
        internalType: "bytes32",
        name: "signedHash",
        type: "bytes32"
      },
      {
        internalType: "bytes",
        name: "signature",
        type: "bytes"
      }
    ],
    name: "handleValidation",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes",
        name: "data",
        type: "bytes"
      }
    ],
    name: "init",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "smartAccount",
        type: "address"
      }
    ],
    name: "isInited",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "name",
    outputs: [
      {
        internalType: "string",
        name: "",
        type: "string"
      }
    ],
    stateMutability: "pure",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "sessionHash",
        type: "bytes32"
      }
    ],
    name: "revokeKey",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32[]",
        name: "sessionHashes",
        type: "bytes32[]"
      }
    ],
    name: "revokeKeys",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "account",
        type: "address"
      },
      {
        components: [
          {
            internalType: "address",
            name: "signer",
            type: "address"
          },
          {
            internalType: "uint256",
            name: "expiresAt",
            type: "uint256"
          },
          {
            components: [
              {
                internalType: "enum SessionLib.LimitType",
                name: "limitType",
                type: "uint8"
              },
              {
                internalType: "uint256",
                name: "limit",
                type: "uint256"
              },
              {
                internalType: "uint256",
                name: "period",
                type: "uint256"
              }
            ],
            internalType: "struct SessionLib.UsageLimit",
            name: "feeLimit",
            type: "tuple"
          },
          {
            components: [
              {
                internalType: "address",
                name: "target",
                type: "address"
              },
              {
                internalType: "bytes4",
                name: "selector",
                type: "bytes4"
              },
              {
                internalType: "uint256",
                name: "maxValuePerUse",
                type: "uint256"
              },
              {
                components: [
                  {
                    internalType: "enum SessionLib.LimitType",
                    name: "limitType",
                    type: "uint8"
                  },
                  {
                    internalType: "uint256",
                    name: "limit",
                    type: "uint256"
                  },
                  {
                    internalType: "uint256",
                    name: "period",
                    type: "uint256"
                  }
                ],
                internalType: "struct SessionLib.UsageLimit",
                name: "valueLimit",
                type: "tuple"
              },
              {
                components: [
                  {
                    internalType: "enum SessionLib.Condition",
                    name: "condition",
                    type: "uint8"
                  },
                  {
                    internalType: "uint64",
                    name: "index",
                    type: "uint64"
                  },
                  {
                    internalType: "bytes32",
                    name: "refValue",
                    type: "bytes32"
                  },
                  {
                    components: [
                      {
                        internalType: "enum SessionLib.LimitType",
                        name: "limitType",
                        type: "uint8"
                      },
                      {
                        internalType: "uint256",
                        name: "limit",
                        type: "uint256"
                      },
                      {
                        internalType: "uint256",
                        name: "period",
                        type: "uint256"
                      }
                    ],
                    internalType: "struct SessionLib.UsageLimit",
                    name: "limit",
                    type: "tuple"
                  }
                ],
                internalType: "struct SessionLib.Constraint[]",
                name: "constraints",
                type: "tuple[]"
              }
            ],
            internalType: "struct SessionLib.CallSpec[]",
            name: "callPolicies",
            type: "tuple[]"
          },
          {
            components: [
              {
                internalType: "address",
                name: "target",
                type: "address"
              },
              {
                internalType: "uint256",
                name: "maxValuePerUse",
                type: "uint256"
              },
              {
                components: [
                  {
                    internalType: "enum SessionLib.LimitType",
                    name: "limitType",
                    type: "uint8"
                  },
                  {
                    internalType: "uint256",
                    name: "limit",
                    type: "uint256"
                  },
                  {
                    internalType: "uint256",
                    name: "period",
                    type: "uint256"
                  }
                ],
                internalType: "struct SessionLib.UsageLimit",
                name: "valueLimit",
                type: "tuple"
              }
            ],
            internalType: "struct SessionLib.TransferSpec[]",
            name: "transferPolicies",
            type: "tuple[]"
          }
        ],
        internalType: "struct SessionLib.SessionSpec",
        name: "spec",
        type: "tuple"
      }
    ],
    name: "sessionState",
    outputs: [
      {
        components: [
          {
            internalType: "uint256",
            name: "expiresAt",
            type: "uint256"
          },
          {
            internalType: "enum SessionLib.Status",
            name: "status",
            type: "uint8"
          },
          {
            internalType: "uint256",
            name: "feesRemaining",
            type: "uint256"
          },
          {
            components: [
              {
                internalType: "uint256",
                name: "remaining",
                type: "uint256"
              },
              {
                internalType: "address",
                name: "target",
                type: "address"
              },
              {
                internalType: "bytes4",
                name: "selector",
                type: "bytes4"
              },
              {
                internalType: "uint256",
                name: "index",
                type: "uint256"
              }
            ],
            internalType: "struct SessionLib.LimitState[]",
            name: "transferValue",
            type: "tuple[]"
          },
          {
            components: [
              {
                internalType: "uint256",
                name: "remaining",
                type: "uint256"
              },
              {
                internalType: "address",
                name: "target",
                type: "address"
              },
              {
                internalType: "bytes4",
                name: "selector",
                type: "bytes4"
              },
              {
                internalType: "uint256",
                name: "index",
                type: "uint256"
              }
            ],
            internalType: "struct SessionLib.LimitState[]",
            name: "callValue",
            type: "tuple[]"
          },
          {
            components: [
              {
                internalType: "uint256",
                name: "remaining",
                type: "uint256"
              },
              {
                internalType: "address",
                name: "target",
                type: "address"
              },
              {
                internalType: "bytes4",
                name: "selector",
                type: "bytes4"
              },
              {
                internalType: "uint256",
                name: "index",
                type: "uint256"
              }
            ],
            internalType: "struct SessionLib.LimitState[]",
            name: "callParams",
            type: "tuple[]"
          }
        ],
        internalType: "struct SessionLib.SessionState",
        name: "",
        type: "tuple"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "account",
        type: "address"
      },
      {
        internalType: "bytes32",
        name: "sessionHash",
        type: "bytes32"
      }
    ],
    name: "sessionStatus",
    outputs: [
      {
        internalType: "enum SessionLib.Status",
        name: "",
        type: "uint8"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes4",
        name: "interfaceId",
        type: "bytes4"
      }
    ],
    name: "supportsInterface",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "pure",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "signedHash",
        type: "bytes32"
      },
      {
        components: [
          {
            internalType: "uint256",
            name: "txType",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "from",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "to",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "gasLimit",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "gasPerPubdataByteLimit",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "maxFeePerGas",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "maxPriorityFeePerGas",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "paymaster",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "nonce",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "value",
            type: "uint256"
          },
          {
            internalType: "uint256[4]",
            name: "reserved",
            type: "uint256[4]"
          },
          {
            internalType: "bytes",
            name: "data",
            type: "bytes"
          },
          {
            internalType: "bytes",
            name: "signature",
            type: "bytes"
          },
          {
            internalType: "bytes32[]",
            name: "factoryDeps",
            type: "bytes32[]"
          },
          {
            internalType: "bytes",
            name: "paymasterInput",
            type: "bytes"
          },
          {
            internalType: "bytes",
            name: "reservedDynamic",
            type: "bytes"
          }
        ],
        internalType: "struct Transaction",
        name: "transaction",
        type: "tuple"
      },
      {
        internalType: "bytes",
        name: "hookData",
        type: "bytes"
      }
    ],
    name: "validationHook",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "version",
    outputs: [
      {
        internalType: "string",
        name: "",
        type: "string"
      }
    ],
    stateMutability: "pure",
    type: "function"
  }
];
class AccountNotFoundError extends BaseError {
  constructor({ docsPath: docsPath2 } = {}) {
    super([
      "Could not find an Account to execute with this Action.",
      "Please provide an Account with the `account` argument on the Action, or by supplying an `account` to the Client."
    ].join("\n"), {
      docsPath: docsPath2,
      docsSlug: "account",
      name: "AccountNotFoundError"
    });
  }
}
var LimitType;
(function(LimitType2) {
  LimitType2[LimitType2["Unlimited"] = 0] = "Unlimited";
  LimitType2[LimitType2["Lifetime"] = 1] = "Lifetime";
  LimitType2[LimitType2["Allowance"] = 2] = "Allowance";
})(LimitType || (LimitType = {}));
({
  limitType: LimitType.Unlimited
});
({
  limitType: LimitType.Lifetime
});
var ConstraintCondition;
(function(ConstraintCondition2) {
  ConstraintCondition2[ConstraintCondition2["Unconstrained"] = 0] = "Unconstrained";
  ConstraintCondition2[ConstraintCondition2["Equal"] = 1] = "Equal";
  ConstraintCondition2[ConstraintCondition2["Greater"] = 2] = "Greater";
  ConstraintCondition2[ConstraintCondition2["Less"] = 3] = "Less";
  ConstraintCondition2[ConstraintCondition2["GreaterEqual"] = 4] = "GreaterEqual";
  ConstraintCondition2[ConstraintCondition2["LessEqual"] = 5] = "LessEqual";
  ConstraintCondition2[ConstraintCondition2["NotEqual"] = 6] = "NotEqual";
})(ConstraintCondition || (ConstraintCondition = {}));
var SessionStatus;
(function(SessionStatus2) {
  SessionStatus2[SessionStatus2["NotInitialized"] = 0] = "NotInitialized";
  SessionStatus2[SessionStatus2["Active"] = 1] = "Active";
  SessionStatus2[SessionStatus2["Closed"] = 2] = "Closed";
  SessionStatus2[SessionStatus2["Expired"] = 3] = "Expired";
})(SessionStatus || (SessionStatus = {}));
function getSessionSpec() {
  return getAbiItem({
    abi: SessionKeyValidatorAbi,
    name: "createSession"
  }).inputs[0];
}
function encodeSession(sessionConfig) {
  return encodeAbiParameters([getSessionSpec()], [sessionConfig]);
}
function encodeSessionWithPeriodIds(sessionConfig, periods) {
  return encodeAbiParameters([getSessionSpec(), { type: "uint64[]" }], [sessionConfig, periods]);
}
const getPeriodIdsForTransaction = (args) => {
  const timestamp = args.timestamp || BigInt(Math.floor(Date.now() / 1e3));
  const target = getAddress(args.target);
  const getId = (limit) => {
    if (limit.limitType === LimitType.Allowance) {
      return timestamp / limit.period;
    }
    return 0n;
  };
  const findTransferPolicy = () => {
    return args.sessionConfig.transferPolicies.find((policy2) => policy2.target.toLowerCase() === target.toLowerCase());
  };
  const findCallPolicy = () => {
    return args.sessionConfig.callPolicies.find((policy2) => policy2.target.toLowerCase() === target.toLowerCase() && policy2.selector === args.selector);
  };
  const isContractCall = !!args.selector && args.selector.length >= 10;
  const policy = isContractCall ? findCallPolicy() : findTransferPolicy();
  if (!policy)
    throw new Error("Transaction does not fit any policy");
  const periodIds = [
    getId(args.sessionConfig.feeLimit),
    getId(policy.valueLimit),
    ...isContractCall ? policy.constraints.map((constraint) => getId(constraint.limit)) : []
  ];
  return periodIds;
};
function getSessionHash(sessionConfig) {
  return keccak256(encodeSession(sessionConfig));
}
async function createSession(client, args) {
  const { account: account_ = client.account, chain = client.chain, session, ...rest } = args;
  if (typeof account_ === "undefined")
    throw new AccountNotFoundError({
      docsPath: "/docs/actions/wallet/sendTransaction"
    });
  const account = parseAccount(account_);
  const createSessionCall = await prepareCreateSessionCall(account, client, session);
  const transactionHash = await getAction(client, sendTransaction$1, "sendTransaction")({
    ...createSessionCall,
    ...rest,
    account,
    chain
  });
  return { transactionHash, session };
}
async function prepareCreateSessionCall(accountOrAddress, client, session) {
  const account = parseAccount(accountOrAddress);
  const isDeployed = await isSmartAccountDeployed(client, account.address);
  const hasModule = isDeployed ? await hasSessionModule(account, client) : false;
  if (!hasModule) {
    const encodedSession = encodeSession(session);
    return {
      to: account.address,
      value: 0n,
      data: encodeFunctionData({
        abi: AGWAccountAbi,
        functionName: "addModule",
        args: [concatHex([SESSION_KEY_VALIDATOR_ADDRESS, encodedSession])]
      })
    };
  } else {
    return {
      to: SESSION_KEY_VALIDATOR_ADDRESS,
      value: 0n,
      data: encodeFunctionData({
        abi: SessionKeyValidatorAbi,
        functionName: "createSession",
        args: [session]
      })
    };
  }
}
async function hasSessionModule(account, client) {
  const validationHooks = await getAction(client, readContract, "readContract")({
    address: account.address,
    abi: AGWAccountAbi,
    functionName: "listHooks",
    args: [true]
  });
  const hasSessionModule2 = validationHooks.some((hook) => hook === SESSION_KEY_VALIDATOR_ADDRESS);
  return hasSessionModule2;
}
const contractDeployerAbi = [
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "accountAddress",
        type: "address"
      },
      {
        indexed: false,
        internalType: "enum IContractDeployer.AccountNonceOrdering",
        name: "nonceOrdering",
        type: "uint8"
      }
    ],
    name: "AccountNonceOrderingUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "accountAddress",
        type: "address"
      },
      {
        indexed: false,
        internalType: "enum IContractDeployer.AccountAbstractionVersion",
        name: "aaVersion",
        type: "uint8"
      }
    ],
    name: "AccountVersionUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "deployerAddress",
        type: "address"
      },
      {
        indexed: true,
        internalType: "bytes32",
        name: "bytecodeHash",
        type: "bytes32"
      },
      {
        indexed: true,
        internalType: "address",
        name: "contractAddress",
        type: "address"
      }
    ],
    name: "ContractDeployed",
    type: "event"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "_salt",
        type: "bytes32"
      },
      {
        internalType: "bytes32",
        name: "_bytecodeHash",
        type: "bytes32"
      },
      {
        internalType: "bytes",
        name: "_input",
        type: "bytes"
      }
    ],
    name: "create",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "_salt",
        type: "bytes32"
      },
      {
        internalType: "bytes32",
        name: "_bytecodeHash",
        type: "bytes32"
      },
      {
        internalType: "bytes",
        name: "_input",
        type: "bytes"
      }
    ],
    name: "create2",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "_salt",
        type: "bytes32"
      },
      {
        internalType: "bytes32",
        name: "_bytecodeHash",
        type: "bytes32"
      },
      {
        internalType: "bytes",
        name: "_input",
        type: "bytes"
      },
      {
        internalType: "enum IContractDeployer.AccountAbstractionVersion",
        name: "_aaVersion",
        type: "uint8"
      }
    ],
    name: "create2Account",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      },
      {
        internalType: "bytes32",
        name: "_bytecodeHash",
        type: "bytes32"
      },
      {
        internalType: "bytes",
        name: "_input",
        type: "bytes"
      },
      {
        internalType: "enum IContractDeployer.AccountAbstractionVersion",
        name: "_aaVersion",
        type: "uint8"
      }
    ],
    name: "createAccount",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_address",
        type: "address"
      }
    ],
    name: "extendedAccountVersion",
    outputs: [
      {
        internalType: "enum IContractDeployer.AccountAbstractionVersion",
        name: "",
        type: "uint8"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "_keccak256BytecodeHash",
        type: "bytes32"
      }
    ],
    name: "forceDeployKeccak256",
    outputs: [],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [
      {
        components: [
          {
            internalType: "bytes32",
            name: "bytecodeHash",
            type: "bytes32"
          },
          {
            internalType: "address",
            name: "newAddress",
            type: "address"
          },
          {
            internalType: "bool",
            name: "callConstructor",
            type: "bool"
          },
          {
            internalType: "uint256",
            name: "value",
            type: "uint256"
          },
          {
            internalType: "bytes",
            name: "input",
            type: "bytes"
          }
        ],
        internalType: "struct ContractDeployer.ForceDeployment",
        name: "_deployment",
        type: "tuple"
      },
      {
        internalType: "address",
        name: "_sender",
        type: "address"
      }
    ],
    name: "forceDeployOnAddress",
    outputs: [],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [
      {
        components: [
          {
            internalType: "bytes32",
            name: "bytecodeHash",
            type: "bytes32"
          },
          {
            internalType: "address",
            name: "newAddress",
            type: "address"
          },
          {
            internalType: "bool",
            name: "callConstructor",
            type: "bool"
          },
          {
            internalType: "uint256",
            name: "value",
            type: "uint256"
          },
          {
            internalType: "bytes",
            name: "input",
            type: "bytes"
          }
        ],
        internalType: "struct ContractDeployer.ForceDeployment[]",
        name: "_deployments",
        type: "tuple[]"
      }
    ],
    name: "forceDeployOnAddresses",
    outputs: [],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_address",
        type: "address"
      }
    ],
    name: "getAccountInfo",
    outputs: [
      {
        components: [
          {
            internalType: "enum IContractDeployer.AccountAbstractionVersion",
            name: "supportedAAVersion",
            type: "uint8"
          },
          {
            internalType: "enum IContractDeployer.AccountNonceOrdering",
            name: "nonceOrdering",
            type: "uint8"
          }
        ],
        internalType: "struct IContractDeployer.AccountInfo",
        name: "info",
        type: "tuple"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_sender",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "_senderNonce",
        type: "uint256"
      }
    ],
    name: "getNewAddressCreate",
    outputs: [
      {
        internalType: "address",
        name: "newAddress",
        type: "address"
      }
    ],
    stateMutability: "pure",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_sender",
        type: "address"
      },
      {
        internalType: "bytes32",
        name: "_bytecodeHash",
        type: "bytes32"
      },
      {
        internalType: "bytes32",
        name: "_salt",
        type: "bytes32"
      },
      {
        internalType: "bytes",
        name: "_input",
        type: "bytes"
      }
    ],
    name: "getNewAddressCreate2",
    outputs: [
      {
        internalType: "address",
        name: "newAddress",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "enum IContractDeployer.AccountAbstractionVersion",
        name: "_version",
        type: "uint8"
      }
    ],
    name: "updateAccountVersion",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "enum IContractDeployer.AccountNonceOrdering",
        name: "_nonceOrdering",
        type: "uint8"
      }
    ],
    name: "updateNonceOrdering",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  }
];
const accountAbstractionVersion1 = 1;
const docsPath = "/docs/contract/encodeDeployData";
function encodeDeployData(parameters) {
  const { abi, args, bytecode, deploymentType, salt } = parameters;
  if (!args || args.length === 0) {
    const { functionName: functionName2, argsContractDeployer: argsContractDeployer2 } = getDeploymentDetails(deploymentType, salt ?? zeroHash, toHex(hashBytecode(bytecode)), "0x");
    return encodeFunctionData({
      abi: contractDeployerAbi,
      functionName: functionName2,
      args: argsContractDeployer2
    });
  }
  const description = abi.find((x) => "type" in x && x.type === "constructor");
  if (!description)
    throw new AbiConstructorNotFoundError({ docsPath });
  if (!("inputs" in description))
    throw new AbiConstructorParamsNotFoundError({ docsPath });
  if (!description.inputs || description.inputs.length === 0)
    throw new AbiConstructorParamsNotFoundError({ docsPath });
  const data = encodeAbiParameters(description.inputs, args);
  const { functionName, argsContractDeployer } = getDeploymentDetails(deploymentType, salt ?? zeroHash, toHex(hashBytecode(bytecode)), data);
  return encodeFunctionData({
    abi: contractDeployerAbi,
    functionName,
    args: argsContractDeployer
  });
}
function getDeploymentDetails(deploymentType, salt, bytecodeHash, data) {
  const contractDeploymentArgs = [salt, bytecodeHash, data];
  const deploymentOptions = {
    create: {
      functionName: "create",
      argsContractDeployer: contractDeploymentArgs
    },
    create2: {
      functionName: "create2",
      argsContractDeployer: contractDeploymentArgs
    },
    createAccount: {
      functionName: "createAccount",
      argsContractDeployer: [
        ...contractDeploymentArgs,
        accountAbstractionVersion1
      ]
    },
    create2Account: {
      functionName: "create2Account",
      argsContractDeployer: [
        ...contractDeploymentArgs,
        accountAbstractionVersion1
      ]
    }
  };
  const deploymentKey = deploymentType || "create";
  return deploymentOptions[deploymentKey];
}
class InsufficientBalanceError extends BaseError {
  constructor() {
    super(["Insufficient balance for transaction."].join("\n"), {
      name: "InsufficientBalanceError"
    });
  }
}
const replaceBigInts = (obj, replacer) => {
  if (typeof obj === "bigint")
    return replacer(obj);
  if (Array.isArray(obj))
    return obj.map((x) => replaceBigInts(x, replacer));
  if (obj && typeof obj === "object")
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, replaceBigInts(v, replacer)]));
  return obj;
};
async function sendPrivySignMessage(client, parameters) {
  const result = await client.request({
    method: "privy_signSmartWalletMessage",
    params: [parameters.message]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }, { retryCount: 0 });
  return result;
}
async function sendPrivySignTypedData(client, parameters) {
  const result = await client.request({
    method: "privy_signSmartWalletTypedData",
    params: [client.account.address, parameters]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }, { retryCount: 0 });
  return result;
}
async function signPrivyTransaction(client, parameters) {
  const { chain: _chain, account: _account, ...request } = parameters;
  const result = await client.request({
    method: "privy_signSmartWalletTx",
    params: [replaceBigInts(request, toHex)]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }, { retryCount: 0 });
  return result;
}
const ExclusiveDelegateResolverAbi = [
  {
    type: "function",
    name: "DELEGATE_REGISTRY",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "GLOBAL_DELEGATION",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes24",
        internalType: "bytes24"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "decodeRightsExpiration",
    inputs: [
      {
        name: "rights",
        type: "bytes32",
        internalType: "bytes32"
      }
    ],
    outputs: [
      {
        name: "",
        type: "bytes24",
        internalType: "bytes24"
      },
      {
        name: "",
        type: "uint40",
        internalType: "uint40"
      }
    ],
    stateMutability: "pure"
  },
  {
    type: "function",
    name: "delegatedWalletsByRights",
    inputs: [
      {
        name: "wallet",
        type: "address",
        internalType: "address"
      },
      {
        name: "rights",
        type: "bytes24",
        internalType: "bytes24"
      }
    ],
    outputs: [
      {
        name: "",
        type: "address[]",
        internalType: "address[]"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "exclusiveOwnerByRights",
    inputs: [
      {
        name: "contractAddress",
        type: "address",
        internalType: "address"
      },
      {
        name: "tokenId",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "rights",
        type: "bytes24",
        internalType: "bytes24"
      }
    ],
    outputs: [
      {
        name: "owner",
        type: "address",
        internalType: "address"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "exclusiveWalletByRights",
    inputs: [
      {
        name: "vault",
        type: "address",
        internalType: "address"
      },
      {
        name: "rights",
        type: "bytes24",
        internalType: "bytes24"
      }
    ],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "generateRightsWithExpiration",
    inputs: [
      {
        name: "rightsIdentifier",
        type: "bytes24",
        internalType: "bytes24"
      },
      {
        name: "expiration",
        type: "uint40",
        internalType: "uint40"
      }
    ],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32"
      }
    ],
    stateMutability: "pure"
  }
];
async function getSessionStatus(publicClient, address, sessionHashOrConfig) {
  const sessionHash2 = typeof sessionHashOrConfig === "string" ? sessionHashOrConfig : getSessionHash(sessionHashOrConfig);
  return await publicClient.readContract({
    address: SESSION_KEY_VALIDATOR_ADDRESS,
    abi: SessionKeyValidatorAbi,
    functionName: "sessionStatus",
    args: [address, sessionHash2]
  });
}
async function sendTransactionForSession(client, signerClient, publicClient, parameters, session, customPaymasterHandler = void 0) {
  const selector = parameters.data ? `0x${parameters.data.slice(2, 10)}` : void 0;
  if (!parameters.to) {
    throw new BaseError("Transaction to field is not specified");
  }
  return sendTransactionInternal(client, signerClient, publicClient, parameters, SESSION_KEY_VALIDATOR_ADDRESS, {
    [SESSION_KEY_VALIDATOR_ADDRESS]: encodeSessionWithPeriodIds(session, getPeriodIdsForTransaction({
      sessionConfig: session,
      target: parameters.to,
      selector,
      timestamp: BigInt(Math.floor(Date.now() / 1e3))
    }))
  }, customPaymasterHandler);
}
async function sendTransactionForSessionSync(client, signerClient, publicClient, parameters, session, customPaymasterHandler = void 0) {
  const { throwOnReceiptRevert, timeout, ...txParameters } = parameters;
  const selector = txParameters.data ? `0x${txParameters.data.slice(2, 10)}` : void 0;
  if (!txParameters.to) {
    throw new BaseError("Transaction to field is not specified");
  }
  return sendTransactionInternal(client, signerClient, publicClient, txParameters, SESSION_KEY_VALIDATOR_ADDRESS, {
    [SESSION_KEY_VALIDATOR_ADDRESS]: encodeSessionWithPeriodIds(session, getPeriodIdsForTransaction({
      sessionConfig: session,
      target: txParameters.to,
      selector,
      timestamp: BigInt(Math.floor(Date.now() / 1e3))
    }))
  }, customPaymasterHandler, (serializedTransaction) => getAction(client, sendRawTransactionSync, "sendRawTransactionSync")({
    serializedTransaction,
    throwOnReceiptRevert,
    timeout
  }));
}
const SessionKeyPolicyRegistryAbi = [
  {
    inputs: [],
    stateMutability: "nonpayable",
    type: "constructor"
  },
  {
    inputs: [],
    name: "AccessControlBadConfirmation",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "account",
        type: "address"
      },
      {
        internalType: "bytes32",
        name: "neededRole",
        type: "bytes32"
      }
    ],
    name: "AccessControlUnauthorizedAccount",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "target",
        type: "address"
      }
    ],
    name: "AddressEmptyCode",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "implementation",
        type: "address"
      }
    ],
    name: "ERC1967InvalidImplementation",
    type: "error"
  },
  {
    inputs: [],
    name: "ERC1967NonPayable",
    type: "error"
  },
  {
    inputs: [],
    name: "FailedCall",
    type: "error"
  },
  {
    inputs: [],
    name: "InvalidInitialization",
    type: "error"
  },
  {
    inputs: [],
    name: "NotInitializing",
    type: "error"
  },
  {
    inputs: [],
    name: "UUPSUnauthorizedCallContext",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "slot",
        type: "bytes32"
      }
    ],
    name: "UUPSUnsupportedProxiableUUID",
    type: "error"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint64",
        name: "version",
        type: "uint64"
      }
    ],
    name: "Initialized",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "enum PolicyType",
        name: "policyType",
        type: "uint8"
      },
      {
        indexed: true,
        internalType: "address",
        name: "target",
        type: "address"
      },
      {
        indexed: true,
        internalType: "bytes32",
        name: "data",
        type: "bytes32"
      },
      {
        indexed: false,
        internalType: "enum Status",
        name: "status",
        type: "uint8"
      }
    ],
    name: "PolicyStatusChanged",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        indexed: true,
        internalType: "bytes32",
        name: "previousAdminRole",
        type: "bytes32"
      },
      {
        indexed: true,
        internalType: "bytes32",
        name: "newAdminRole",
        type: "bytes32"
      }
    ],
    name: "RoleAdminChanged",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        indexed: true,
        internalType: "address",
        name: "account",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "sender",
        type: "address"
      }
    ],
    name: "RoleGranted",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        indexed: true,
        internalType: "address",
        name: "account",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "sender",
        type: "address"
      }
    ],
    name: "RoleRevoked",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "implementation",
        type: "address"
      }
    ],
    name: "Upgraded",
    type: "event"
  },
  {
    inputs: [],
    name: "DEFAULT_ADMIN_ROLE",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "MANAGER_ROLE",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "UPGRADE_INTERFACE_VERSION",
    outputs: [
      {
        internalType: "string",
        name: "",
        type: "string"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "token",
        type: "address"
      },
      {
        internalType: "address",
        name: "target",
        type: "address"
      }
    ],
    name: "getApprovalTargetStatus",
    outputs: [
      {
        internalType: "enum Status",
        name: "",
        type: "uint8"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "target",
        type: "address"
      },
      {
        internalType: "bytes4",
        name: "selector",
        type: "bytes4"
      }
    ],
    name: "getCallPolicyStatus",
    outputs: [
      {
        internalType: "enum Status",
        name: "",
        type: "uint8"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      }
    ],
    name: "getRoleAdmin",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "target",
        type: "address"
      }
    ],
    name: "getTransferPolicyStatus",
    outputs: [
      {
        internalType: "enum Status",
        name: "",
        type: "uint8"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "grantRole",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "hasRole",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "owner",
        type: "address"
      }
    ],
    name: "initialize",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "proxiableUUID",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        internalType: "address",
        name: "callerConfirmation",
        type: "address"
      }
    ],
    name: "renounceRole",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "revokeRole",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "token",
        type: "address"
      },
      {
        internalType: "address",
        name: "target",
        type: "address"
      },
      {
        internalType: "enum Status",
        name: "status",
        type: "uint8"
      }
    ],
    name: "setApprovalTargetStatus",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "target",
        type: "address"
      },
      {
        internalType: "bytes4",
        name: "selector",
        type: "bytes4"
      },
      {
        internalType: "enum Status",
        name: "status",
        type: "uint8"
      }
    ],
    name: "setCallPolicyStatus",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "target",
        type: "address"
      },
      {
        internalType: "enum Status",
        name: "status",
        type: "uint8"
      }
    ],
    name: "setTransferPolicyStatus",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes4",
        name: "interfaceId",
        type: "bytes4"
      }
    ],
    name: "supportsInterface",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "newImplementation",
        type: "address"
      },
      {
        internalType: "bytes",
        name: "data",
        type: "bytes"
      }
    ],
    name: "upgradeToAndCall",
    outputs: [],
    stateMutability: "payable",
    type: "function"
  }
];
const restrictedSelectors = /* @__PURE__ */ new Set([
  toFunctionSelector("function setApprovalForAll(address, bool)"),
  toFunctionSelector("function approve(address, uint256)"),
  toFunctionSelector("function transfer(address, uint256)")
]);
var SessionKeyPolicyStatus;
(function(SessionKeyPolicyStatus2) {
  SessionKeyPolicyStatus2[SessionKeyPolicyStatus2["Unset"] = 0] = "Unset";
  SessionKeyPolicyStatus2[SessionKeyPolicyStatus2["Allowed"] = 1] = "Allowed";
  SessionKeyPolicyStatus2[SessionKeyPolicyStatus2["Denied"] = 2] = "Denied";
})(SessionKeyPolicyStatus || (SessionKeyPolicyStatus = {}));
async function assertSessionKeyPolicies(client, chainId, account, transaction) {
  var _a;
  if (chainId !== abstract.id) {
    return;
  }
  const sessions = [];
  if (transaction.to === account.address && ((_a = transaction.data) == null ? void 0 : _a.substring(0, 10)) === BATCH_CALL_SELECTOR) {
    const batchCall = decodeFunctionData({
      abi: AGWAccountAbi,
      data: transaction.data
    });
    if (batchCall.functionName === "batchCall") {
      for (const call of batchCall.args[0]) {
        const subTransaction = {
          ...transaction,
          to: call.target,
          data: call.callData
        };
        const session = getSessionFromTransaction(account, subTransaction);
        if (session) {
          sessions.push(session);
        }
      }
    }
  } else {
    const session = getSessionFromTransaction(account, transaction);
    if (session) {
      sessions.push(session);
    }
  }
  if (sessions.length === 0) {
    return;
  }
  for (const session of sessions) {
    const callPolicies = session.callPolicies;
    const transferPolicies = session.transferPolicies;
    const checks = [];
    for (const callPolicy of callPolicies) {
      if (restrictedSelectors.has(callPolicy.selector)) {
        const destinationConstraints = callPolicy.constraints.filter((c) => c.index === 0n && c.condition === ConstraintCondition.Equal);
        if (destinationConstraints.length === 0) {
          throw new BaseError(`Unconstrained token approval/transfer destination in call policy. Selector: ${callPolicy.selector}; Target: ${callPolicy.target}`);
        }
        for (const constraint of destinationConstraints) {
          const [target] = decodeAbiParameters([
            {
              type: "address"
            }
          ], constraint.refValue);
          checks.push({
            target,
            check: {
              address: SESSION_KEY_POLICY_REGISTRY_ADDRESS,
              abi: SessionKeyPolicyRegistryAbi,
              functionName: "getApprovalTargetStatus",
              args: [
                callPolicy.target,
                // token address
                target
                // allowed spender
              ]
            }
          });
        }
      } else {
        checks.push({
          target: callPolicy.target,
          check: {
            address: SESSION_KEY_POLICY_REGISTRY_ADDRESS,
            abi: SessionKeyPolicyRegistryAbi,
            functionName: "getCallPolicyStatus",
            args: [callPolicy.target, callPolicy.selector]
          }
        });
      }
    }
    for (const transferPolicy of transferPolicies) {
      checks.push({
        target: transferPolicy.target,
        check: {
          address: SESSION_KEY_POLICY_REGISTRY_ADDRESS,
          abi: SessionKeyPolicyRegistryAbi,
          functionName: "getTransferPolicyStatus",
          args: [transferPolicy.target]
        }
      });
    }
    const results = await client.multicall({
      contracts: checks.map((c) => c.check),
      allowFailure: false
    });
    for (let i = 0; i < checks.length; i++) {
      const result = results[i];
      const check = checks[i];
      if (Number(result) !== SessionKeyPolicyStatus.Allowed) {
        throw new BaseError(`Session key policy violation. Target: ${check == null ? void 0 : check.target}; Status: ${SessionKeyPolicyStatus[Number(result)]}`);
      }
    }
  }
}
function getSessionFromTransaction(account, transaction) {
  var _a, _b;
  if (transaction.to === SESSION_KEY_VALIDATOR_ADDRESS && ((_a = transaction.data) == null ? void 0 : _a.substring(0, 10)) === CREATE_SESSION_SELECTOR) {
    const sessionSpec = decodeFunctionData({
      abi: SessionKeyValidatorAbi,
      data: transaction.data
    });
    if (sessionSpec.functionName === "createSession") {
      return sessionSpec.args[0];
    }
  }
  if (transaction.to === (account == null ? void 0 : account.address) && ((_b = transaction.data) == null ? void 0 : _b.substring(0, 10)) === ADD_MODULE_SELECTOR) {
    const moduleAndData = decodeFunctionData({
      abi: AGWAccountAbi,
      data: transaction.data
    });
    if (moduleAndData.functionName === "addModule" && moduleAndData.args[0].toLowerCase().startsWith(SESSION_KEY_VALIDATOR_ADDRESS.toLowerCase())) {
      const sessionData = moduleAndData.args[0].substring(42);
      return decodeAbiParameters([getSessionSpec()], `0x${sessionData}`)[0];
    }
  }
  return void 0;
}
async function signTransaction(client, signerClient, publicClient, args, validator, validationHookData = {}, customPaymasterHandler = void 0, isPrivyCrossApp = false) {
  var _a;
  const chain = client.chain;
  if (isPrivyCrossApp) {
    return signPrivyTransaction(client, args);
  }
  if (!((_a = chain == null ? void 0 : chain.serializers) == null ? void 0 : _a.transaction))
    throw new BaseError("transaction serializer not found on chain.");
  const { transaction, customSignature } = await signEip712TransactionInternal(client, signerClient, publicClient, args, validator, validationHookData, customPaymasterHandler);
  return chain.serializers.transaction({
    ...transaction,
    customSignature,
    type: "eip712"
  }, { r: "0x0", s: "0x0", v: 0n });
}
async function signEip712TransactionInternal(client, signerClient, publicClient, args, validator, validationHookData = {}, customPaymasterHandler = void 0) {
  var _a;
  args.type = "eip712";
  const { account: account_ = client.account, chain = client.chain, ...transaction } = args;
  transformHexValues(transaction, [
    "value",
    "nonce",
    "maxFeePerGas",
    "maxPriorityFeePerGas",
    "gas",
    "chainId",
    "gasPerPubdata"
  ]);
  if (!account_)
    throw new AccountNotFoundError({
      docsPath: "/docs/actions/wallet/signTransaction"
    });
  const smartAccount = parseAccount(account_);
  const useSignerAddress = transaction.from === signerClient.account.address;
  const fromAccount = useSignerAddress ? signerClient.account : smartAccount;
  assertEip712Request({
    account: fromAccount,
    chain,
    ...transaction
  });
  if (!chain || VALID_CHAINS[chain.id] === void 0) {
    throw new BaseError("Invalid chain specified");
  }
  if (!((_a = chain == null ? void 0 : chain.custom) == null ? void 0 : _a.getEip712Domain))
    throw new BaseError("`getEip712Domain` not found on chain.");
  const chainId = await getAction(client, getChainId, "getChainId")({});
  if (chain !== null)
    assertCurrentChain({
      currentChainId: chainId,
      chain
    });
  await assertSessionKeyPolicies(publicClient, chainId, fromAccount, transaction);
  const transactionWithPaymaster = await getTransactionWithPaymasterData(chainId, fromAccount, transaction, customPaymasterHandler);
  if (transactionWithPaymaster.data === void 0) {
    transactionWithPaymaster.data = "0x";
  }
  const eip712Domain = chain == null ? void 0 : chain.custom.getEip712Domain({
    ...transactionWithPaymaster,
    type: "eip712"
  });
  const rawSignature = await signTypedData$1(signerClient, {
    ...eip712Domain,
    account: signerClient.account
  });
  let signature;
  if (useSignerAddress) {
    signature = rawSignature;
  } else {
    const hookData = [];
    if (!useSignerAddress) {
      const validationHooks = await getAction(client, readContract, "readContract")({
        address: client.account.address,
        abi: AGWAccountAbi,
        functionName: "listHooks",
        args: [true]
      });
      for (const hook of validationHooks) {
        hookData.push(validationHookData[hook] ?? "0x");
      }
    }
    signature = encodeAbiParameters(parseAbiParameters(["bytes", "address", "bytes[]"]), [rawSignature, validator, hookData]);
  }
  return {
    transaction: transactionWithPaymaster,
    customSignature: signature
  };
}
async function getTransactionWithPaymasterData(chainId, fromAccount, transaction, customPaymasterHandler = void 0) {
  if (customPaymasterHandler && !transaction.paymaster && !transaction.paymasterInput) {
    const paymasterResult = await customPaymasterHandler({
      chainId,
      from: fromAccount.address,
      data: transaction.data,
      gas: transaction.gas ?? 0n,
      gasPrice: transaction.gasPrice ?? 0n,
      gasPerPubdata: transaction.gasPerPubdata ?? 0n,
      maxFeePerGas: transaction.maxFeePerGas ?? 0n,
      maxPriorityFeePerGas: transaction.maxPriorityFeePerGas ?? 0n,
      nonce: transaction.nonce ?? 0,
      to: transaction.to ?? "0x0",
      value: transaction.value ?? 0n
    });
    return {
      ...transaction,
      ...paymasterResult,
      from: fromAccount.address,
      chainId
    };
  }
  return {
    ...transaction,
    from: fromAccount.address,
    chainId
  };
}
async function signTransactionForSession(client, signerClient, publicClient, parameters, session, customPaymasterHandler = void 0) {
  const isDeployed = await isSmartAccountDeployed(publicClient, client.account.address);
  if (!isDeployed) {
    throw new BaseError("Smart account not deployed");
  }
  const selector = parameters.data ? `0x${parameters.data.slice(2, 10)}` : void 0;
  if (!parameters.to) {
    throw new BaseError("Transaction to field is not specified");
  }
  return await signTransaction(client, signerClient, publicClient, parameters, SESSION_KEY_VALIDATOR_ADDRESS, {
    [SESSION_KEY_VALIDATOR_ADDRESS]: encodeSessionWithPeriodIds(session, getPeriodIdsForTransaction({
      sessionConfig: session,
      target: parameters.to,
      selector,
      timestamp: BigInt(Math.floor(Date.now() / 1e3))
    }))
  }, customPaymasterHandler);
}
async function getAgwTypedSignature(args) {
  const { client, signer, messageHash } = args;
  const chainId = client.chain.id;
  const account = client.account;
  const rawSignature = await signTypedData$1(signer, {
    domain: {
      name: "AbstractGlobalWallet",
      version: "1.0.0",
      chainId: BigInt(chainId),
      verifyingContract: account.address
    },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" }
      ],
      AGWMessage: [{ name: "signedHash", type: "bytes32" }]
    },
    message: {
      signedHash: messageHash
    },
    primaryType: "AGWMessage"
  });
  const signature = encodeAbiParameters(parseAbiParameters(["bytes", "address"]), [rawSignature, EOA_VALIDATOR_ADDRESS]);
  const code = await getCode(client, {
    address: account.address
  });
  if (code !== void 0) {
    return signature;
  }
  const addressBytes = toBytes(signer.account.address);
  const salt = keccak256(addressBytes);
  return serializeErc6492Signature({
    address: SMART_ACCOUNT_FACTORY_ADDRESS,
    data: encodeFunctionData({
      abi: AccountFactoryAbi,
      functionName: "deployAccount",
      args: [
        salt,
        getInitializerCalldata(signer.account.address, EOA_VALIDATOR_ADDRESS, {
          target: zeroAddress,
          allowFailure: false,
          callData: "0x",
          value: 0n
        })
      ]
    }),
    signature
  });
}
async function signTypedData(client, signerClient, publicClient, parameters, isPrivyCrossApp = false) {
  if (isEip712TypedData(parameters)) {
    const transformedTypedData = transformEip712TypedData(parameters);
    if (transformedTypedData.chainId !== client.chain.id) {
      throw new BaseError("Chain ID mismatch in AGW typed signature");
    }
    const signedTransaction = await signTransaction(client, signerClient, publicClient, {
      ...transformedTypedData,
      chain: client.chain
    }, EOA_VALIDATOR_ADDRESS, {}, void 0, isPrivyCrossApp);
    if (!signedTransaction.startsWith("0x71")) {
      throw new BaseError("Expected RLP encoded EIP-712 transaction as signature");
    }
    const rlpSignature = `0x${signedTransaction.slice(4)}`;
    const signatureParts = fromRlp(rlpSignature, "hex");
    if (signatureParts.length < 15) {
      throw new BaseError("Expected RLP encoded EIP-712 transaction with at least 15 fields");
    }
    return signatureParts[14];
  } else if (isPrivyCrossApp) {
    return await sendPrivySignTypedData(client, parameters);
  }
  return await getAgwTypedSignature({
    client,
    signer: signerClient,
    messageHash: hashTypedData(parameters)
  });
}
async function signTypedDataForSession(client, signerClient, publicClient, parameters, session, paymasterHandler) {
  var _a;
  if (!isEip712TypedData(parameters)) {
    throw new BaseError("Session client can only sign EIP712 transactions as typed data");
  }
  const transactionRequest = transformEip712TypedData(parameters);
  if (!transactionRequest.to) {
    throw new BaseError("Transaction must have a to address");
  }
  const validationHookData = {
    [SESSION_KEY_VALIDATOR_ADDRESS]: encodeSessionWithPeriodIds(session, getPeriodIdsForTransaction({
      sessionConfig: session,
      target: transactionRequest.to,
      selector: ((_a = transactionRequest.data) == null ? void 0 : _a.slice(0, 10)) ?? "0x",
      timestamp: BigInt(Math.floor(Date.now() / 1e3))
    }))
  };
  const { customSignature } = await signEip712TransactionInternal(client, signerClient, publicClient, {
    chain: client.chain,
    ...transactionRequest
  }, SESSION_KEY_VALIDATOR_ADDRESS, validationHookData, paymasterHandler);
  return customSignature;
}
async function writeContractForSession(client, signerClient, publicClient, parameters, session, customPaymasterHandler = void 0) {
  const { abi, account: account_ = client.account, address, args, dataSuffix, functionName, ...request } = parameters;
  if (!account_)
    throw new AccountNotFoundError({
      docsPath: "/docs/contract/writeContract"
    });
  const account = parseAccount(account_);
  const data = encodeFunctionData({
    abi,
    args,
    functionName
  });
  try {
    return await sendTransactionForSession(client, signerClient, publicClient, {
      data: `${data}${dataSuffix ? dataSuffix.replace("0x", "") : ""}`,
      to: address,
      account,
      ...request
    }, session, customPaymasterHandler);
  } catch (error) {
    throw getContractError(error, {
      abi,
      address,
      args,
      docsPath: "/docs/contract/writeContract",
      functionName,
      sender: account.address
    });
  }
}
async function writeContractForSessionSync(client, signerClient, publicClient, parameters, session, customPaymasterHandler = void 0) {
  const { abi, account: account_ = client.account, address, args, dataSuffix, functionName, throwOnReceiptRevert, timeout, ...request } = parameters;
  if (!account_)
    throw new AccountNotFoundError({
      docsPath: "/docs/contract/writeContract"
    });
  const account = parseAccount(account_);
  const data = encodeFunctionData({
    abi,
    args,
    functionName
  });
  try {
    return await sendTransactionForSessionSync(client, signerClient, publicClient, {
      data: `${data}${dataSuffix ? dataSuffix.replace("0x", "") : ""}`,
      to: address,
      account,
      throwOnReceiptRevert,
      timeout,
      ...request
    }, session, customPaymasterHandler);
  } catch (error) {
    throw getContractError(error, {
      abi,
      address,
      args,
      docsPath: "/docs/contract/writeContract",
      functionName,
      sender: account.address
    });
  }
}
function sessionWalletActions(signerClient, publicClient, session, paymasterHandler) {
  return (client) => ({
    sendTransaction: (args) => sendTransactionForSession(client, signerClient, publicClient, args, session, paymasterHandler),
    writeContract: (args) => writeContractForSession(client, signerClient, publicClient, args, session, paymasterHandler),
    sendTransactionSync: (args) => sendTransactionForSessionSync(client, signerClient, publicClient, args, session, paymasterHandler),
    writeContractSync: (args) => writeContractForSessionSync(client, signerClient, publicClient, args, session, paymasterHandler),
    signTransaction: (args) => signTransactionForSession(client, signerClient, publicClient, args, session, paymasterHandler),
    signTypedData: (args) => signTypedDataForSession(client, signerClient, publicClient, args, session, paymasterHandler),
    getSessionStatus: () => getSessionStatus(publicClient, parseAccount(client.account).address, session)
  });
}
function toSessionClient({ client, signer, session, paymasterHandler }) {
  return createSessionClient({
    account: client.account,
    chain: client.chain,
    session,
    signer,
    transport: custom(client.transport),
    paymasterHandler
  });
}
function createSessionClient({ account, signer, chain, transport, session, paymasterHandler, nonceManager }) {
  if (!transport) {
    transport = http(void 0, {
      batch: true
    });
  }
  const publicClient = createPublicClient({
    transport,
    chain
  });
  const parsedAccount = typeof account === "string" ? toAccount(account) : account;
  if (nonceManager) {
    parsedAccount.nonceManager = nonceManager;
  }
  const baseClient = createClient({
    account: parsedAccount,
    chain,
    transport
  });
  const signerWalletClient = createWalletClient({
    account: signer,
    chain,
    transport
  });
  const sessionClient = baseClient.extend(sessionWalletActions(signerWalletClient, publicClient, session, paymasterHandler));
  return sessionClient;
}
const defaultParameters = [
  "blobVersionedHashes",
  "chainId",
  "fees",
  "gas",
  "nonce",
  "type"
];
async function prepareTransactionRequest(client, signerClient, publicClient, args) {
  transformHexValues(args, [
    "value",
    "nonce",
    "maxFeePerGas",
    "maxPriorityFeePerGas",
    "gas",
    "chainId",
    "gasPerPubdata"
  ]);
  const isSponsored = "paymaster" in args && "paymasterInput" in args && args.paymaster !== void 0 && args.paymasterInput !== void 0;
  const { gas, nonce, chain, nonceManager, parameters: parameterNames = defaultParameters } = args;
  const isDeployed = await isSmartAccountDeployed(publicClient, client.account.address);
  if (!isDeployed) {
    const initialCall = {
      target: args.to,
      allowFailure: false,
      value: args.value ?? 0,
      callData: args.data ?? "0x"
    };
    const initializerCallData = getInitializerCalldata(signerClient.account.address, EOA_VALIDATOR_ADDRESS, initialCall);
    const addressBytes = toBytes(signerClient.account.address);
    const salt = keccak256(addressBytes);
    const deploymentCalldata = encodeFunctionData({
      abi: AccountFactoryAbi,
      functionName: "deployAccount",
      args: [salt, initializerCallData]
    });
    args.to = SMART_ACCOUNT_FACTORY_ADDRESS;
    args.data = deploymentCalldata;
  }
  const initiatorAccount = parseAccount(isDeployed ? client.account : signerClient.account);
  const request = {
    ...args,
    from: initiatorAccount.address
  };
  const asyncOperations = [];
  let userBalance;
  if (!isSponsored || request.value !== void 0 && request.value > 0n) {
    asyncOperations.push(getBalance(publicClient, {
      address: initiatorAccount.address
    }).then((balance) => {
      userBalance = balance;
    }));
  }
  let chainId;
  async function getChainId$1() {
    if (chainId)
      return chainId;
    if (chain)
      return chain.id;
    if (typeof args.chainId !== "undefined")
      return args.chainId;
    const chainId_ = await getAction(client, getChainId, "getChainId")({});
    chainId = chainId_;
    return chainId;
  }
  if (parameterNames.includes("nonce") && typeof nonce === "undefined" && initiatorAccount) {
    if (nonceManager) {
      asyncOperations.push((async () => {
        const chainId2 = await getChainId$1();
        request.nonce = await nonceManager.consume({
          address: initiatorAccount.address,
          chainId: chainId2,
          client: publicClient
        });
      })());
    } else {
      asyncOperations.push(getAction(publicClient, getTransactionCount, "getTransactionCount")({
        address: initiatorAccount.address,
        blockTag: "pending"
      }).then((nonce2) => {
        request.nonce = nonce2;
      }));
    }
  }
  if (parameterNames.includes("fees")) {
    if (typeof request.maxFeePerGas === "undefined") {
      asyncOperations.push((async () => {
        request.maxFeePerGas = await getGasPrice(publicClient);
        request.maxPriorityFeePerGas = 0n;
      })());
    }
  }
  if (parameterNames.includes("gas") && typeof gas === "undefined") {
    asyncOperations.push((async () => {
      try {
        request.gas = await getAction(publicClient, estimateGas, "estimateGas")({
          ...request,
          account: initiatorAccount ? { address: initiatorAccount.address, type: "json-rpc" } : void 0
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes(INSUFFICIENT_BALANCE_SELECTOR)) {
          throw new InsufficientBalanceError();
        } else if (error instanceof RpcRequestError && error.details.includes("execution reverted")) {
          throw new ExecutionRevertedError({
            message: `${error.data}`
          });
        }
        throw error;
      }
    })());
  }
  await Promise.all(asyncOperations);
  const gasCost = isSponsored || !request.gas || !request.maxFeePerGas ? 0n : request.gas * request.maxFeePerGas;
  if (userBalance !== void 0 && userBalance < (request.value ?? 0n) + gasCost) {
    throw new InsufficientBalanceError();
  }
  assertRequest(request);
  delete request.parameters;
  delete request.isInitialTransaction;
  delete request.nonceManager;
  return request;
}
async function sendTransactionInternal(client, signerClient, publicClient, parameters, validator, validationHookData = {}, customPaymasterHandler = void 0, sendSerializedTransaction) {
  const { chain = client.chain } = parameters;
  if (!signerClient.account)
    throw new AccountNotFoundError({
      docsPath: "/docs/actions/wallet/sendTransaction"
    });
  const account = parseAccount(signerClient.account);
  try {
    const request = await prepareTransactionRequest(client, signerClient, publicClient, {
      ...parameters,
      parameters: ["gas", "nonce", "fees"],
      isSponsored: customPaymasterHandler !== void 0 || parameters.paymaster !== void 0,
      nonceManager: account.nonceManager
    });
    let chainId;
    if (chain !== null) {
      chainId = await getAction(signerClient, getChainId, "getChainId")({});
      assertCurrentChain({
        currentChainId: chainId,
        chain
      });
    }
    const serializedTransaction = await signTransaction(client, signerClient, publicClient, {
      ...request,
      chainId
    }, validator, validationHookData, customPaymasterHandler);
    if (sendSerializedTransaction) {
      return await sendSerializedTransaction(serializedTransaction);
    }
    return await getAction(client, sendRawTransaction, "sendRawTransaction")({
      serializedTransaction
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes(INSUFFICIENT_BALANCE_SELECTOR)) {
      throw new InsufficientBalanceError();
    }
    throw getTransactionError(err, {
      ...parameters,
      account,
      chain
    });
  }
}
async function sendTransaction(client, signerClient, publicClient, parameters, isPrivyCrossApp = false, customPaymasterHandler = void 0) {
  var _a;
  if (isPrivyCrossApp) {
    try {
      let paymasterData = {};
      const requestAsAny = parameters;
      if (customPaymasterHandler && !requestAsAny.paymaster && !requestAsAny.paymasterInput) {
        paymasterData = await customPaymasterHandler({
          ...parameters,
          from: client.account.address,
          chainId: ((_a = parameters.chain) == null ? void 0 : _a.id) ?? client.chain.id
        });
      }
      const updatedParameters = {
        ...parameters,
        ...paymasterData
      };
      const signedTx = await signPrivyTransaction(client, updatedParameters);
      return await publicClient.sendRawTransaction({
        serializedTransaction: signedTx
      });
    } catch (err) {
      if (err instanceof Error && err.message.includes(INSUFFICIENT_BALANCE_SELECTOR)) {
        throw new InsufficientBalanceError();
      }
      throw getTransactionError(err, {
        ...parameters,
        account: parameters.account ? parseAccount(parameters.account) : null,
        chain: parameters.chain ?? void 0
      });
    }
  }
  return sendTransactionInternal(client, signerClient, publicClient, parameters, EOA_VALIDATOR_ADDRESS, {}, customPaymasterHandler);
}
function deployContract(walletClient, signerClient, publicClient, parameters, isPrivyCrossApp = false) {
  const { abi, args, bytecode, deploymentType, salt, ...request } = parameters;
  const data = encodeDeployData({
    abi,
    args,
    bytecode,
    deploymentType,
    salt
  });
  request.factoryDeps = request.factoryDeps || [];
  if (!request.factoryDeps.includes(bytecode))
    request.factoryDeps.push(bytecode);
  return sendTransaction(walletClient, signerClient, publicClient, {
    ...request,
    data,
    to: CONTRACT_DEPLOYER_ADDRESS
  }, isPrivyCrossApp);
}
async function getCallsStatus(client, parameters) {
  if (!isHex(parameters.id)) {
    throw new InvalidParameterError({ param: "id" });
  }
  let receipt;
  try {
    receipt = await getTransactionReceipt(client, {
      hash: parameters.id
    });
  } catch (error) {
    if (error instanceof TransactionReceiptNotFoundError) {
      receipt = void 0;
    } else {
      throw error;
    }
  }
  const [status, statusCode] = (() => {
    if (!receipt)
      return ["pending", 100];
    if (receipt.status === "success")
      return ["success", 200];
    if (receipt.status === "reverted")
      return ["failure", 500];
    return [void 0, 400];
  })();
  return {
    atomic: true,
    chainId: client.chain.id,
    receipts: receipt ? [receipt] : void 0,
    status,
    id: parameters.id,
    statusCode,
    version: "2.0.0"
  };
}
var CallStatus;
(function(CallStatus2) {
  CallStatus2[CallStatus2["Pending"] = 100] = "Pending";
  CallStatus2[CallStatus2["Confirmed"] = 200] = "Confirmed";
  CallStatus2[CallStatus2["OffchainFailure"] = 400] = "OffchainFailure";
  CallStatus2[CallStatus2["Reverted"] = 500] = "Reverted";
  CallStatus2[CallStatus2["PartiallyReverted"] = 600] = "PartiallyReverted";
})(CallStatus || (CallStatus = {}));
const agwCapabilities = {
  atomicBatch: {
    supported: true
  },
  atomic: {
    status: "supported"
  }
};
async function getCapabilities(_client, parameters = {}) {
  const { chainId } = parameters;
  const capabilities = {};
  if (chainId) {
    if (!VALID_CHAINS[chainId]) {
      throw new UnsupportedChainIdError(new Error(`Chain ${chainId} not supported`));
    }
    return agwCapabilities;
  }
  for (const chainId2 of Object.keys(VALID_CHAINS)) {
    capabilities[Number(chainId2)] = agwCapabilities;
  }
  return capabilities;
}
async function getLinkedAccounts(client, parameters) {
  const { agwAddress } = parameters;
  if (!isAddress(agwAddress, { strict: false })) {
    throw new InvalidAddressError({ address: agwAddress });
  }
  const checksummedAddress = getAddress(agwAddress);
  const result = await getAction(client, readContract, "readContract")({
    abi: ExclusiveDelegateResolverAbi,
    address: CANONICAL_EXCLUSIVE_DELEGATE_RESOLVER_ADDRESS,
    functionName: "delegatedWalletsByRights",
    args: [checksummedAddress, AGW_LINK_DELEGATION_RIGHTS]
  });
  return {
    linkedAccounts: [...result]
  };
}
async function getLinkedAgw(client, parameters) {
  var _a;
  const { address = (_a = client.account) == null ? void 0 : _a.address } = parameters ?? {};
  if (address === void 0) {
    throw new BaseError("No address provided");
  }
  if (!isAddress(address, { strict: false })) {
    throw new InvalidAddressError({ address });
  }
  const checksummedAddress = getAddress(address);
  const result = await getAction(client, readContract, "readContract")({
    abi: ExclusiveDelegateResolverAbi,
    address: CANONICAL_EXCLUSIVE_DELEGATE_RESOLVER_ADDRESS,
    functionName: "exclusiveWalletByRights",
    args: [checksummedAddress, AGW_LINK_DELEGATION_RIGHTS]
  });
  if (result === checksummedAddress) {
    return {
      agw: void 0
    };
  }
  return {
    agw: result
  };
}
async function isLinkedAccount(client, parameters) {
  const { address } = parameters;
  if (client.account === void 0) {
    throw new AccountNotFoundError({
      docsPath: "/docs/contract/readContract"
    });
  }
  const clientAccount = parseAccount(client.account);
  const { agw } = await getLinkedAgw(client, { address });
  return agw === clientAccount.address;
}
async function revokeSessions(client, args) {
  const { session, ...rest } = args;
  const sessionHashes = typeof session === "string" ? [session] : Array.isArray(session) ? session.map(sessionHash) : [getSessionHash(session)];
  const transactionHash = await getAction(client, writeContract$1, "writeContract")({
    address: SESSION_KEY_VALIDATOR_ADDRESS,
    abi: SessionKeyValidatorAbi,
    functionName: "revokeKeys",
    args: [sessionHashes],
    ...rest
  });
  return { transactionHash };
}
function sessionHash(session) {
  if (typeof session === "string") {
    return session;
  }
  return getSessionHash(session);
}
function getBatchTransactionObject(address, parameters) {
  const { calls, paymaster, paymasterInput } = parameters;
  const batchCalls = formatCalls(calls);
  const batchCallData = encodeFunctionData({
    abi: AGWAccountAbi,
    functionName: "batchCall",
    args: [batchCalls]
  });
  const totalValue = batchCalls.reduce((sum, call) => sum + BigInt(call.value), BigInt(0));
  return {
    to: address,
    data: batchCallData,
    value: totalValue,
    paymaster,
    paymasterInput,
    type: "eip712"
  };
}
async function sendTransactionBatch(client, signerClient, publicClient, parameters, isPrivyCrossApp = false, customPaymasterHandler = void 0) {
  const { calls, ...rest } = parameters;
  if (calls.length === 0) {
    throw new Error("No calls provided");
  }
  if (isPrivyCrossApp) {
    const signedTx = await signPrivyTransaction(client, {
      ...rest,
      calls: encodeCalls(calls)
    });
    return await publicClient.sendRawTransaction({
      serializedTransaction: signedTx
    });
  }
  const batchTransaction = getBatchTransactionObject(client.account.address, {
    calls,
    ...rest
  });
  return sendTransactionInternal(client, signerClient, publicClient, {
    ...batchTransaction,
    ...rest
  }, EOA_VALIDATOR_ADDRESS, {}, customPaymasterHandler);
}
async function sendCalls(client, signerClient, publicClient, parameters, isPrivyCrossApp = false, customPaymasterHandler = void 0) {
  const { calls, capabilities } = parameters;
  if (capabilities) {
    const nonOptionalCapabilities = Object.entries(capabilities).filter(([_, capability]) => !capability.optional);
    for (const [capability] of nonOptionalCapabilities) {
      if (!agwCapabilities[capability]) {
        const message = `non-optional capability ${capability} is not supported`;
        throw new UnsupportedNonOptionalCapabilityError(new BaseError(message, {
          details: message
        }));
      }
    }
  }
  const result = await sendTransactionBatch(client, signerClient, publicClient, {
    calls
  }, isPrivyCrossApp, customPaymasterHandler);
  return {
    id: result
  };
}
async function sendTransactionSync(client, signerClient, publicClient, parameters, isPrivyCrossApp = false, customPaymasterHandler = void 0) {
  var _a;
  const { throwOnReceiptRevert, timeout, ...txParameters } = parameters;
  if (isPrivyCrossApp) {
    try {
      let paymasterData = {};
      const requestAsAny = txParameters;
      if (customPaymasterHandler && !requestAsAny.paymaster && !requestAsAny.paymasterInput) {
        paymasterData = await customPaymasterHandler({
          ...txParameters,
          from: client.account.address,
          chainId: ((_a = txParameters.chain) == null ? void 0 : _a.id) ?? client.chain.id
        });
      }
      const updatedParameters = {
        ...txParameters,
        ...paymasterData
      };
      const signedTx = await signPrivyTransaction(client, updatedParameters);
      return await sendRawTransactionSync(publicClient, {
        serializedTransaction: signedTx,
        throwOnReceiptRevert,
        timeout
      });
    } catch (err) {
      if (err instanceof Error && err.message.includes(INSUFFICIENT_BALANCE_SELECTOR)) {
        throw new InsufficientBalanceError();
      }
      throw getTransactionError(err, {
        ...txParameters,
        account: txParameters.account ? parseAccount(txParameters.account) : null,
        chain: txParameters.chain ?? void 0
      });
    }
  }
  return sendTransactionInternal(client, signerClient, publicClient, txParameters, EOA_VALIDATOR_ADDRESS, {}, customPaymasterHandler, (serializedTransaction) => getAction(client, sendRawTransactionSync, "sendRawTransactionSync")({
    serializedTransaction,
    throwOnReceiptRevert,
    timeout
  }));
}
async function signMessage(client, signerClient, parameters, isPrivyCrossApp = false) {
  if (isPrivyCrossApp) {
    if (typeof parameters.message === "object") {
      if (parameters.message.raw instanceof Uint8Array) {
        parameters.message = bytesToString(parameters.message.raw);
      } else {
        parameters.message = fromHex(parameters.message.raw, "string");
      }
    }
    return await sendPrivySignMessage(client, parameters);
  }
  return await getAgwTypedSignature({
    client,
    signer: signerClient,
    messageHash: hashMessage(parameters.message)
  });
}
async function signTransactionBatch(client, signerClient, publicClient, parameters, validator, validationHookData = {}, customPaymasterHandler = void 0, isPrivyCrossApp = false) {
  const { calls, ...rest } = parameters;
  if (calls.length === 0) {
    throw new Error("No calls provided");
  }
  if (isPrivyCrossApp) {
    return await signPrivyTransaction(client, {
      ...rest,
      calls: encodeCalls(calls)
    });
  }
  const batchTransaction = getBatchTransactionObject(client.account.address, {
    calls,
    ...rest
  });
  return signTransaction(client, signerClient, publicClient, {
    ...batchTransaction,
    ...rest
  }, validator, validationHookData, customPaymasterHandler);
}
async function writeContract(client, signerClient, publicClient, parameters, isPrivyCrossApp = false) {
  const { abi, account: account_ = client.account, address, args, dataSuffix, functionName, ...request } = parameters;
  if (!account_)
    throw new AccountNotFoundError({
      docsPath: "/docs/contract/writeContract"
    });
  const account = parseAccount(account_);
  const data = encodeFunctionData({
    abi,
    args,
    functionName
  });
  try {
    return await sendTransaction(client, signerClient, publicClient, {
      data: `${data}${dataSuffix ? dataSuffix.replace("0x", "") : ""}`,
      to: address,
      account,
      ...request
    }, isPrivyCrossApp);
  } catch (error) {
    throw getContractError(error, {
      abi,
      address,
      args,
      docsPath: "/docs/contract/writeContract",
      functionName,
      sender: account.address
    });
  }
}
async function writeContractSync(client, signerClient, publicClient, parameters, isPrivyCrossApp = false, customPaymasterHandler = void 0) {
  const { abi, account: account_ = client.account, address, args, dataSuffix, functionName, throwOnReceiptRevert, timeout, ...request } = parameters;
  if (!account_)
    throw new AccountNotFoundError({
      docsPath: "/docs/contract/writeContract"
    });
  const account = parseAccount(account_);
  const data = encodeFunctionData({
    abi,
    args,
    functionName
  });
  try {
    return await sendTransactionSync(client, signerClient, publicClient, {
      data: `${data}${dataSuffix ? dataSuffix.replace("0x", "") : ""}`,
      to: address,
      account,
      throwOnReceiptRevert,
      timeout,
      ...request
    }, isPrivyCrossApp, customPaymasterHandler);
  } catch (error) {
    throw getContractError(error, {
      abi,
      address,
      args,
      docsPath: "/docs/contract/writeContract",
      functionName,
      sender: account.address
    });
  }
}
function globalWalletActions(signerClient, publicClient, isPrivyCrossApp = false, customPaymasterHandler) {
  return (client) => ({
    getChainId: () => getChainId(client),
    getLinkedAccounts: () => getLinkedAccounts(client, {
      agwAddress: parseAccount(client.account).address
    }),
    isLinkedAccount: (args) => isLinkedAccount(client, args),
    createSession: (args) => createSession(client, args),
    revokeSessions: (args) => revokeSessions(client, args),
    prepareAbstractTransactionRequest: (args) => prepareTransactionRequest(client, signerClient, publicClient, args),
    sendTransaction: (args) => sendTransaction(client, signerClient, publicClient, args, isPrivyCrossApp, customPaymasterHandler),
    sendTransactionBatch: (args) => sendTransactionBatch(client, signerClient, publicClient, args, isPrivyCrossApp, customPaymasterHandler),
    signMessage: (args) => signMessage(client, signerClient, args, isPrivyCrossApp),
    signTransaction: (args) => signTransaction(client, signerClient, publicClient, args, EOA_VALIDATOR_ADDRESS, {}, customPaymasterHandler, isPrivyCrossApp),
    signTransactionBatch: (args) => signTransactionBatch(client, signerClient, publicClient, args, EOA_VALIDATOR_ADDRESS, {}, customPaymasterHandler, isPrivyCrossApp),
    signTypedData: (args) => signTypedData(client, signerClient, publicClient, args, isPrivyCrossApp),
    deployContract: (args) => deployContract(client, signerClient, publicClient, args, isPrivyCrossApp),
    writeContract: (args) => writeContract(Object.assign(client, {
      sendTransaction: (args2) => sendTransaction(client, signerClient, publicClient, args2, isPrivyCrossApp, customPaymasterHandler)
    }), signerClient, publicClient, args, isPrivyCrossApp),
    sendTransactionSync: (args) => sendTransactionSync(client, signerClient, publicClient, args, isPrivyCrossApp, customPaymasterHandler),
    writeContractSync: (args) => writeContractSync(client, signerClient, publicClient, args, isPrivyCrossApp, customPaymasterHandler),
    toSessionClient: (signer, session) => toSessionClient({
      client,
      signer,
      session,
      paymasterHandler: customPaymasterHandler
    }),
    getSessionStatus: (sessionHashOrConfig) => getSessionStatus(publicClient, parseAccount(client.account).address, sessionHashOrConfig),
    /** EIP-5792 actions - see https://eips.ethereum.org/EIPS/eip-5792 */
    getCallsStatus: (args) => getCallsStatus(publicClient, args),
    sendCalls: (args) => sendCalls(client, signerClient, publicClient, args, isPrivyCrossApp, customPaymasterHandler),
    getCapabilities: (args) => getCapabilities(client, args),
    showCallsStatus: (_args) => {
      return Promise.resolve();
    }
  });
}
async function createAbstractClient({ signer, chain, transport, address, isPrivyCrossApp = false, publicTransport = http(void 0, {
  batch: true
}), customPaymasterHandler }) {
  if (!transport) {
    throw new Error("Transport is required");
  }
  const publicClient = createPublicClient({
    chain,
    transport: publicTransport
  });
  const smartAccountAddress = address ?? await getSmartAccountAddressFromInitialSigner(signer.address, publicClient);
  const baseClient = createClient({
    account: toAccount(smartAccountAddress),
    chain,
    transport
  });
  const signerWalletClient = createWalletClient({
    account: signer,
    chain,
    transport
  });
  const abstractClient = baseClient.extend(globalWalletActions(signerWalletClient, publicClient, isPrivyCrossApp, customPaymasterHandler));
  return abstractClient;
}
export {
  createAbstractClient,
  getSmartAccountAddressFromInitialSigner,
  VALID_CHAINS as validChains
};
