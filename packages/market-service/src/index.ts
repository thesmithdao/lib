import {
  GetByMarketCapType,
  HistoryData,
  MarketDataArgs,
  MarketDataType,
  PriceHistoryArgs,
  PriceHistoryType
} from '@shapeshiftoss/types'
import { GetByMarketCapArgs } from '@shapeshiftoss/types/src'

import { MarketServiceEnum, MarketServices } from './api'
import { CoinGeckoMarketService } from './coingecko/coingecko'

export const getMarketService = (): MarketServices => {
  return {
    [MarketServiceEnum.COIN_GECKO]: new CoinGeckoMarketService(),
    [MarketServiceEnum.COIN_CAP]: new CoinGeckoMarketService()
  }
}

export const getByMarketCap: GetByMarketCapType = async (args?: GetByMarketCapArgs) => {
  return getMarketService()[MarketServiceEnum.COIN_GECKO].getByMarketCap(args)
}

export const getMarketData: MarketDataType = async ({ chain, tokenId }: MarketDataArgs) => {
  return getMarketService()[MarketServiceEnum.COIN_GECKO].getMarketData({ chain, tokenId })
}

export const getPriceHistory: PriceHistoryType = ({
  chain,
  timeframe,
  tokenId
}: PriceHistoryArgs): Promise<HistoryData[]> => {
  return getMarketService()[MarketServiceEnum.COIN_GECKO].getPriceHistory({
    chain,
    timeframe,
    tokenId
  })
}
