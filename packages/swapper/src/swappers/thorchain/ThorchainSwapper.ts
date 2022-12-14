import { Asset } from '@shapeshiftoss/asset-service'
import {
  adapters,
  AssetId,
  CHAIN_NAMESPACE,
  ChainId,
  fromAssetId,
  thorchainAssetId,
} from '@shapeshiftoss/caip'
import {
  ChainAdapterManager,
  cosmos,
  EvmBaseAdapter,
  UtxoBaseAdapter,
} from '@shapeshiftoss/chain-adapters'
import { BTCSignTx, CosmosSignTx, ETHSignTx } from '@shapeshiftoss/hdwallet-core'
import { KnownChainIds } from '@shapeshiftoss/types'
import Web3 from 'web3'

import type {
  ApprovalNeededInput,
  ApprovalNeededOutput,
  ApproveInfiniteInput,
  BuildTradeInput,
  BuyAssetBySellIdInput,
  EvmSupportedChainIds,
  ExecuteTradeInput,
  GetTradeQuoteInput,
  Swapper,
  Trade,
  TradeQuote,
  TradeResult,
  TradeTxs,
  UtxoSupportedChainIds,
} from '../../api'
import { SwapError, SwapErrorTypes, SwapperName, SwapperType } from '../../api'
import { buildTrade } from './buildThorTrade/buildThorTrade'
import { getThorTradeQuote } from './getThorTradeQuote/getTradeQuote'
import { thorTradeApprovalNeeded } from './thorTradeApprovalNeeded/thorTradeApprovalNeeded'
import { thorTradeApproveInfinite } from './thorTradeApproveInfinite/thorTradeApproveInfinite'
import {
  MidgardActionsResponse,
  ThorchainSwapperDeps,
  ThornodePoolResponse,
  ThorTrade,
} from './types'
import { getUsdRate } from './utils/getUsdRate/getUsdRate'
import { thorService } from './utils/thorService'

export * from './types'

export class ThorchainSwapper implements Swapper<ChainId> {
  readonly name = SwapperName.Thorchain

  private sellSupportedChainIds: Record<ChainId, boolean> = {
    [KnownChainIds.EthereumMainnet]: true,
    [KnownChainIds.BitcoinMainnet]: true,
    [KnownChainIds.DogecoinMainnet]: true,
    [KnownChainIds.LitecoinMainnet]: true,
    [KnownChainIds.BitcoinCashMainnet]: true,
    [KnownChainIds.CosmosMainnet]: true,
    [KnownChainIds.ThorchainMainnet]: true,
    [KnownChainIds.AvalancheMainnet]: false,
  }

  private buySupportedChainIds: Record<ChainId, boolean> = {
    [KnownChainIds.EthereumMainnet]: true,
    [KnownChainIds.BitcoinMainnet]: true,
    [KnownChainIds.DogecoinMainnet]: true,
    [KnownChainIds.LitecoinMainnet]: true,
    [KnownChainIds.BitcoinCashMainnet]: true,
    [KnownChainIds.CosmosMainnet]: true,
    [KnownChainIds.ThorchainMainnet]: true,
    [KnownChainIds.AvalancheMainnet]: false,
  }

  private supportedSellAssetIds: AssetId[] = [thorchainAssetId]
  private supportedBuyAssetIds: AssetId[] = [thorchainAssetId]

  deps: ThorchainSwapperDeps
  daemonUrl: string
  midgardUrl: string
  adapterManager: ChainAdapterManager
  web3: Web3

  constructor(deps: ThorchainSwapperDeps) {
    this.deps = deps
    this.daemonUrl = deps.daemonUrl
    this.midgardUrl = deps.midgardUrl
    this.adapterManager = deps.adapterManager
    this.web3 = deps.web3
  }

  async initialize() {
    try {
      const { data: allPools } = await thorService.get<ThornodePoolResponse[]>(
        `${this.deps.daemonUrl}/lcd/thorchain/pools`,
      )

      const availablePools = allPools.filter((pool) => pool.status === 'Available')

      availablePools.forEach((pool) => {
        const assetId = adapters.poolAssetIdToAssetId(pool.asset)
        if (!assetId) return

        const { chainId } = fromAssetId(assetId)

        this.sellSupportedChainIds[chainId] && this.supportedSellAssetIds.push(assetId)
        this.buySupportedChainIds[chainId] && this.supportedBuyAssetIds.push(assetId)
      })
    } catch (e) {
      throw new SwapError('[thorchainInitialize]: initialize failed to set supportedAssetIds', {
        code: SwapErrorTypes.INITIALIZE_FAILED,
        cause: e,
      })
    }
  }

  getType() {
    return SwapperType.Thorchain
  }

  async getUsdRate({ assetId }: Pick<Asset, 'assetId'>): Promise<string> {
    return getUsdRate(this.daemonUrl, assetId)
  }

  async approvalNeeded(
    input: ApprovalNeededInput<EvmSupportedChainIds>,
  ): Promise<ApprovalNeededOutput> {
    return thorTradeApprovalNeeded({ deps: this.deps, input })
  }

  async approveInfinite(input: ApproveInfiniteInput<EvmSupportedChainIds>): Promise<string> {
    return thorTradeApproveInfinite({ deps: this.deps, input })
  }

  async approveAmount(): Promise<string> {
    throw new SwapError('ThorchainSwapper: approveAmount unimplemented', {
      code: SwapErrorTypes.RESPONSE_ERROR,
    })
  }

  filterBuyAssetsBySellAssetId(args: BuyAssetBySellIdInput): AssetId[] {
    const { assetIds = [], sellAssetId } = args
    if (!this.supportedSellAssetIds.includes(sellAssetId)) return []
    return assetIds.filter(
      (assetId) => this.supportedBuyAssetIds.includes(assetId) && assetId !== sellAssetId,
    )
  }

  filterAssetIdsBySellable(): AssetId[] {
    return this.supportedSellAssetIds
  }

  async buildTrade(input: BuildTradeInput): Promise<Trade<ChainId>> {
    return buildTrade({ deps: this.deps, input })
  }

  async getTradeQuote(input: GetTradeQuoteInput): Promise<TradeQuote<ChainId>> {
    return getThorTradeQuote({ deps: this.deps, input })
  }

  async executeTrade(args: ExecuteTradeInput<ChainId>): Promise<TradeResult> {
    try {
      const { trade, wallet } = args
      const adapter = this.deps.adapterManager.get(trade.sellAsset.chainId)

      if (!adapter)
        throw new SwapError('[executeTrade]: no adapter for sell asset chain id', {
          code: SwapErrorTypes.SIGN_AND_BROADCAST_FAILED,
          details: { chainId: trade.sellAsset.chainId },
          fn: 'executeTrade',
        })

      const { chainNamespace } = fromAssetId(trade.sellAsset.assetId)

      if (chainNamespace === CHAIN_NAMESPACE.Evm) {
        const evmAdapter = adapter as unknown as EvmBaseAdapter<EvmSupportedChainIds>
        const txToSign = (trade as ThorTrade<EvmSupportedChainIds>).txData as ETHSignTx
        if (wallet.supportsBroadcast()) {
          const tradeId = await evmAdapter.signAndBroadcastTransaction({ txToSign, wallet })
          return { tradeId }
        }
        const signedTx = await evmAdapter.signTransaction({ txToSign, wallet })
        const tradeId = await adapter.broadcastTransaction(signedTx)
        return { tradeId }
      } else if (chainNamespace === CHAIN_NAMESPACE.Utxo) {
        const signedTx = await (
          adapter as unknown as UtxoBaseAdapter<UtxoSupportedChainIds>
        ).signTransaction({
          txToSign: (trade as ThorTrade<UtxoSupportedChainIds>).txData as BTCSignTx,
          wallet,
        })
        const txid = await adapter.broadcastTransaction(signedTx)
        return { tradeId: txid }
      } else if (chainNamespace === CHAIN_NAMESPACE.CosmosSdk) {
        const signedTx = await (adapter as unknown as cosmos.ChainAdapter).signTransaction({
          txToSign: (trade as ThorTrade<KnownChainIds.CosmosMainnet>).txData as CosmosSignTx,
          wallet,
        })
        const txid = await adapter.broadcastTransaction(signedTx)
        return { tradeId: txid }
      } else {
        throw new SwapError('[executeTrade]: unsupported trade', {
          code: SwapErrorTypes.SIGN_AND_BROADCAST_FAILED,
          fn: 'executeTrade',
        })
      }
    } catch (e) {
      if (e instanceof SwapError) throw e
      throw new SwapError('[executeTrade]: failed to sign or broadcast', {
        code: SwapErrorTypes.SIGN_AND_BROADCAST_FAILED,
        cause: e,
      })
    }
  }

  async getTradeTxs(tradeResult: TradeResult): Promise<TradeTxs> {
    try {
      const midgardTxid = tradeResult.tradeId.startsWith('0x')
        ? tradeResult.tradeId.slice(2)
        : tradeResult.tradeId

      const { data } = await thorService.get<MidgardActionsResponse>(
        `${this.deps.midgardUrl}/actions?txid=${midgardTxid}`,
      )

      // https://gitlab.com/thorchain/thornode/-/blob/develop/common/tx.go#L22
      // responseData?.actions[0].out[0].txID should be the txId for consistency, but the outbound Tx for Thor rune swaps is actually a BlankTxId
      // so we use the buyTxId for completion detection
      const buyTxid =
        data?.actions[0]?.status === 'success' && data?.actions[0]?.type === 'swap'
          ? midgardTxid
          : ''

      // This will detect all the errors I have seen.
      if (data?.actions[0]?.status === 'success' && data?.actions[0]?.type !== 'swap')
        throw new SwapError('[getTradeTxs]: trade failed', {
          code: SwapErrorTypes.TRADE_FAILED,
          cause: data,
        })

      const standardBuyTxid = (() => {
        const outCoinAsset = data?.actions[0]?.out[0]?.coins[0]?.asset
        const isEvmCoinAsset = outCoinAsset?.startsWith('ETH.') || outCoinAsset?.startsWith('AVAX.')
        return isEvmCoinAsset ? `0x${buyTxid}` : buyTxid
      })().toLowerCase()

      return {
        sellTxid: tradeResult.tradeId,
        buyTxid: standardBuyTxid,
      }
    } catch (e) {
      if (e instanceof SwapError) throw e
      throw new SwapError('[getTradeTxs]: error', {
        code: SwapErrorTypes.GET_TRADE_TXS_FAILED,
        cause: e,
      })
    }
  }
}
