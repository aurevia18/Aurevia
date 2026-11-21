import {MarketDataError,TIMEFRAMES,type LiveMarketAsset,type TimeframeId} from '@/lib/live-market';
import type {ServerConfiguration} from '@/lib/config/env';
import {getConfiguredMarketHistory,getConfiguredMarketIndicator,getConfiguredMarketQuote,getConfiguredMarketSearch,type MarketProviderKeys} from '@/lib/market-data/provider-manager';
import type {TwelveDataIndicator} from '@/lib/providers/twelve-data-market-data';

const maximumFreshQuoteAgeMs=5*60_000;

export function getAdditionalMarketProviderKeys(marketData:ServerConfiguration['marketData']):MarketProviderKeys{
	return {
		twelveDataApiKey:marketData.twelveDataApiKey,
		twelveDataBaseUrl:marketData.twelveDataBaseUrl,
		productionLicenseConfirmed:marketData.productionLicenseConfirmed,
	};
}

export async function getMarketQuoteWithFallback(asset:LiveMarketAsset,providers:MarketProviderKeys){
	const quote=await getConfiguredMarketQuote(asset,providers);
	if(!quote)throw new MarketDataError('Twelve Data quotes are not configured or available.',503);
	const timestamp=Date.parse(quote.updatedAt);
	if(!Number.isFinite(timestamp)){
		throw new MarketDataError('The market provider returned an invalid quote timestamp.',502);
	}
	const age=Date.now()-timestamp;
	if(age < -5_000)throw new MarketDataError('The market provider returned a future-dated quote.',502);
	return {
		...quote,
		isStale:age>maximumFreshQuoteAgeMs,
		...(age>maximumFreshQuoteAgeMs?{staleReason:'Provider quote timestamp is older than five minutes.'}:{}),
	};
}

export async function getMarketHistoryWithFallback(
	asset:LiveMarketAsset,timeframe:TimeframeId,providers:MarketProviderKeys,
){
	const history=await getConfiguredMarketHistory(asset,timeframe,providers);
	if(!history||!history.candles.length)throw new MarketDataError('Twelve Data historical market data is not configured or available.',503);
	const selection=TIMEFRAMES.find(item=>item.id===timeframe)??TIMEFRAMES[0];
	return {
		quote:null,
		candles:history.candles,
		timeframe,
		interval:selection.interval,
		source:history.source,
	};
}

export async function searchMarketSymbols(query:string,limit:number,providers:MarketProviderKeys){
	const results=await getConfiguredMarketSearch(query,limit,providers);
	if(!results)throw new MarketDataError('Twelve Data market search is not configured or available.',503);
	return results;
}

export async function getMarketIndicator(
	symbol:string,indicator:TwelveDataIndicator,timeframe:TimeframeId,outputsize:number,providers:MarketProviderKeys,
){
	const selection=TIMEFRAMES.find(item=>item.id===timeframe);
	if(!selection)throw new MarketDataError('Unsupported indicator timeframe.',400);
	const result=await getConfiguredMarketIndicator(symbol,indicator,selection.interval,outputsize,providers);
	if(!result)throw new MarketDataError('Twelve Data technical indicators are not configured or available.',503);
	return result;
}
