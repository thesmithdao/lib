/** Common */

export type BIP44Params = {
  purpose: number
  coinType: number
  accountNumber: number
  isChange?: boolean
  index?: number
}

const supportedChainIds = [
  'eip155:1',
  'bip122:000000000019d6689c085ae165831e93',
  'cosmos:cosmoshub-4',
  'cosmos:osmosis-1'
] as const

export type SupportedChainIds = typeof supportedChainIds[number]

export enum WithdrawType {
  DELAYED,
  INSTANT
}

export enum UtxoAccountType {
  SegwitNative = 'SegwitNative',
  SegwitP2sh = 'SegwitP2sh',
  P2pkh = 'P2pkh'
}

// asset-service

type AbstractAsset = {
  assetId: string
  chainId: string
  description?: string
  isTrustedDescription?: boolean
  symbol: string
  name: string
  precision: number
  slip44: number
  color: string
  secondaryColor: string
  icon: string
  explorer: string
  explorerTxLink: string
  explorerAddressLink: string
  sendSupport: boolean
  receiveSupport: boolean
}

type OmittedTokenAssetFields =
  | 'chain'
  | 'network'
  | 'slip44'
  | 'explorer'
  | 'explorerTxLink'
  | 'explorerAddressLink'
type TokenAssetFields = {
  tokenId: string
  contractType: 'erc20' | 'erc721' // Don't want to import caip here to prevent circular dependencies
}
export type TokenAsset = Omit<AbstractAsset, OmittedTokenAssetFields> & TokenAssetFields
export type BaseAsset = AbstractAsset & { tokens?: TokenAsset[] }
export type Asset = AbstractAsset & Partial<TokenAssetFields>

// swapper

export enum SwapperType {
  Zrx = '0x',
  Thorchain = 'Thorchain',
  Test = 'Test'
}

export type SwapSource = {
  name: string
  proportion: string
}

export interface MinMaxOutput {
  minimum: string
  maximum: string
}

export type GetMinMaxInput = {
  sellAsset: Asset
  buyAsset: Asset
}

export type ExecQuoteOutput = {
  txid: string
}

export type ApprovalNeededOutput = {
  approvalNeeded: boolean
  gas?: string
  gasPrice?: string
}
