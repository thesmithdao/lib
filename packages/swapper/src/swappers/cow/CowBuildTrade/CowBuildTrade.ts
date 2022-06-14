import { fromAssetId } from '@shapeshiftoss/caip'
import { AxiosResponse } from 'axios'

import { BuildTradeInput, SwapError, SwapErrorTypes, Trade } from '../../../api'
import { erc20AllowanceAbi } from '../../utils/abi/erc20Allowance-abi'
import { bn, bnOrZero } from '../../utils/bignumber'
import { APPROVAL_GAS_LIMIT } from '../../utils/constants'
import { getAllowanceRequired, normalizeAmount } from '../../utils/helpers/helpers'
import { CowSwapperDeps } from '../CowSwapper'
import { CowSwapQuoteResponse } from '../types'
import {
  COW_SWAP_VAULT_RELAYER_ADDRESS,
  DEFAULT_APP_DATA,
  DEFAULT_SOURCE,
  DEFAULT_VALIDTO_TIMESTAMP,
  ORDER_KIND_SELL
} from '../utils/constants'
import { cowService } from '../utils/cowService'
import { getUsdRate } from '../utils/helpers/helpers'

export async function CowBuildTrade(
  deps: CowSwapperDeps,
  input: BuildTradeInput
): Promise<Trade<'eip155:1'>> {
  try {
    const { sellAsset, buyAsset, sellAmount, sellAssetAccountNumber, wallet } = input
    const { adapter } = deps

    const { assetReference: sellAssetErc20Address, assetNamespace: sellAssetNamespace } =
      fromAssetId(sellAsset.assetId)
    const { assetReference: buyAssetErc20Address, assetNamespace: buyAssetNamespace } = fromAssetId(
      buyAsset.assetId
    )

    if (buyAssetNamespace !== 'erc20' || sellAssetNamespace !== 'erc20') {
      throw new SwapError('[CowBuildTrade] - Both assets need to be ERC-20 to use CowSwap', {
        code: SwapErrorTypes.UNSUPPORTED_PAIR,
        details: { buyAssetNamespace, sellAssetNamespace }
      })
    }

    const receiveAddress = await adapter.getAddress({ wallet })

    /**
     * /v1/quote
     * params: {
     * sellToken: contract address of token to sell
     * buyToken: contractAddress of token to buy
     * receiver: receiver address can be defaulted to "0x0000000000000000000000000000000000000000"
     * validTo: time duration during which quote is valid (eg : 1654851610 as timestamp)
     * appData: appData for the CowSwap quote that can be used later, can be defaulted to "0x0000000000000000000000000000000000000000000000000000000000000000"
     * partiallyFillable: false
     * from: sender address can be defaulted to "0x0000000000000000000000000000000000000000"
     * kind: "sell" or "buy"
     * sellAmountBeforeFee / buyAmountAfterFee: amount in base unit
     * }
     */
    const quoteResponse: AxiosResponse<CowSwapQuoteResponse> =
      await cowService.post<CowSwapQuoteResponse>(`${deps.apiUrl}/v1/quote/`, {
        sellToken: sellAssetErc20Address,
        buyToken: buyAssetErc20Address,
        receiver: receiveAddress,
        validTo: DEFAULT_VALIDTO_TIMESTAMP,
        appData: DEFAULT_APP_DATA,
        partiallyFillable: false,
        from: receiveAddress,
        kind: ORDER_KIND_SELL,
        sellAmountBeforeFee: normalizeAmount(sellAmount)
      })

    const { data } = quoteResponse
    const quote = data.quote

    const rate = bn(quote.buyAmount)
      .div(quote.sellAmount)
      .times(bn(10).exponentiatedBy(sellAsset.precision - buyAsset.precision))
      .toString()

    const feeDataOptions = await adapter.getFeeData({
      to: COW_SWAP_VAULT_RELAYER_ADDRESS,
      value: sellAmount,
      chainSpecific: { from: receiveAddress, contractAddress: sellAssetErc20Address },
      sendMax: true
    })
    const feeData = feeDataOptions['fast']

    const usdRateSellAsset = await getUsdRate(deps, sellAsset)
    const feeUsd = bnOrZero(quote.feeAmount)
      .div(bn(10).exponentiatedBy(sellAsset.precision))
      .multipliedBy(bnOrZero(usdRateSellAsset))
      .toString()

    const trade: Trade<'eip155:1'> = {
      rate,
      feeData: {
        fee: feeUsd,
        chainSpecific: {
          estimatedGas: feeData.chainSpecific.gasLimit,
          gasPrice: feeData.chainSpecific.gasPrice
        },
        tradeFee: '0'
      },
      sellAmount: quote.sellAmount,
      buyAmount: quote.buyAmount,
      sources: DEFAULT_SOURCE,
      buyAsset,
      sellAsset,
      sellAssetAccountNumber,
      receiveAddress
    }

    const allowanceRequired = await getAllowanceRequired({
      sellAsset,
      allowanceContract: COW_SWAP_VAULT_RELAYER_ADDRESS,
      receiveAddress,
      sellAmount: quote.sellAmount,
      web3: deps.web3,
      erc20AllowanceAbi
    })

    if (allowanceRequired) {
      trade.feeData.chainSpecific.approvalFee = bnOrZero(APPROVAL_GAS_LIMIT)
        .multipliedBy(bnOrZero(feeData.chainSpecific.gasPrice))
        .toString()
    }

    return trade
  } catch (e) {
    if (e instanceof SwapError) throw e
    throw new SwapError('[CowBuildTrade]', {
      cause: e,
      code: SwapErrorTypes.TRADE_QUOTE_FAILED
    })
  }
}
