import Bottleneck from 'bottleneck';
import {createHash} from 'node:crypto';
import {LRUCache} from 'lru-cache';
import type {LiveMarketAsset,MarketCandle,MarketQuote,TimeframeId} from '@/lib/live-market';
import {TIMEFRAMES} from '@/lib/live-market';
import {TwelveDataMarketProvider} from '@/lib/providers/twelve-data-market-data';
import type {TwelveDataIndicator} from '@/lib/providers/twelve-data-market-data';
import type {MarketProviderHttpError} from '@/lib/providers/market-data-http';
import {aggregateChartCandles,normalizeChartCandles} from '@/lib/chart-candles';

export type MarketProviderKeys={
	twelveDataApiKey:string;
	twelveDataBaseUrl:string;
	productionLicenseConfirmed:boolean;
};

type ProviderId='twelveData';
type ProviderState={
	fingerprint:string;
	status:'CONNECTED'|'ERROR';
	checkedAt:string;
	lastSuccessfulRequestAt?:string;
	lastDataAt?:string;
	failureUntil?:number;
	errorCode?:string;
	rateLimitErrors:number;
	providerErrors:number;
};
type Adapter={
	id:ProviderId;
	name:string;
	key:string;
	baseUrl?:string;
	categories:readonly LiveMarketAsset['type'][];
	historyIntervals?:readonly string[];
	getQuote:(asset:LiveMarketAsset)=>Promise<MarketQuote>;
	getHistory?:(asset:LiveMarketAsset,from:string,to:string,interval:string)=>Promise<MarketCandle[]>;
	search?:(query:string,limit:number)=>Promise<unknown[]>;
	getIndicator?:(symbol:string,indicator:TwelveDataIndicator,interval:string,outputsize:number)=>Promise<unknown>;
	getMarketState?:()=>Promise<unknown[]>;
};

const providerHealth=new LRUCache<ProviderId,ProviderState>({max:3,ttl:10*60_000});
const quoteCache=new LRUCache<string,Promise<MarketQuote>>({max:400,ttl:15_000});
const historyCache=new LRUCache<string,Promise<MarketCandle[]>>({max:200,ttl:60_000});
const searchCache=new LRUCache<string,Promise<unknown[]>>({max:100,ttl:60*60_000});
const indicatorCache=new LRUCache<string,Promise<unknown>>({max:200,ttl:5*60_000});
const marketStateCache=new LRUCache<string,Promise<unknown[]>>({max:1,ttl:60_000});
const isolatedTwelveDataMock=(()=>{
	if(process.env.AUREVIA_E2E_TWELVE_DATA_MOCK!=='1'||!process.env.AUREVIA_E2E_DATABASE_URL)return false;
	try{
		const databaseUrl=new URL(process.env.AUREVIA_E2E_DATABASE_URL);
		const databaseName=decodeURIComponent(databaseUrl.pathname.replace(/^\/+/,''));
		return ['postgresql:','postgres:'].includes(databaseUrl.protocol)
			&&['localhost','127.0.0.1','::1'].includes(databaseUrl.hostname)
			&&/_e2e$/i.test(databaseName)
			&&process.env.TWELVE_DATA_API_KEY==='aurevia-e2e-only-not-a-real-key';
	}catch{return false}
})();
const limiters={
	twelveData:new Bottleneck({
		maxConcurrent:isolatedTwelveDataMock?20:1,
		minTime:isolatedTwelveDataMock?0:8_000,
		highWater:isolatedTwelveDataMock?100:5,
		strategy:Bottleneck.strategy.OVERFLOW,
	}),
};

function fingerprint(key:string){return createHash('sha256').update(key).digest('hex')}
function adapters(keys:MarketProviderKeys):Adapter[]{
	return [
		...(keys.twelveDataApiKey?[{
			id:'twelveData' as const,name:'Twelve Data',key:keys.twelveDataApiKey,baseUrl:keys.twelveDataBaseUrl,
			categories:['STOCK','FOREX','CRYPTO'] as const,
			getQuote:(asset:LiveMarketAsset)=>provider().getQuote(asset),
			getHistory:(asset:LiveMarketAsset,from:string,to:string,interval:string)=>provider().getHistory(asset,from,to,interval),
			search:(query:string,limit:number)=>provider().search(query,limit),
			getIndicator:(symbol:string,indicator:TwelveDataIndicator,interval:string,outputsize:number)=>provider().getIndicator(symbol,indicator,interval,outputsize),
			getMarketState:()=>provider().getMarketState(),
		}]:[]),
	];
	function provider(){
		return new TwelveDataMarketProvider({apiKey:keys.twelveDataApiKey,baseUrl:keys.twelveDataBaseUrl});
	}
}

function recordFailure(adapter:Adapter,error:unknown){
	const now=Date.now();
	const errorCode=error&&typeof error==='object'&&'code'in error&&typeof (error as MarketProviderHttpError).code==='string'
		?(error as MarketProviderHttpError).code:'INVALID_PROVIDER_RESPONSE';
	const current=providerHealth.get(adapter.id);
	const sameCredential=current?.fingerprint===fingerprint(adapter.key);
	providerHealth.set(adapter.id,{
		fingerprint:fingerprint(adapter.key),status:'ERROR',checkedAt:new Date(now).toISOString(),
		...(sameCredential&&current.lastSuccessfulRequestAt?{lastSuccessfulRequestAt:current.lastSuccessfulRequestAt}:{}),
		...(sameCredential&&current.lastDataAt?{lastDataAt:current.lastDataAt}:{}),
		failureUntil:now+30_000,errorCode,
		rateLimitErrors:(sameCredential?current.rateLimitErrors:0)+(errorCode==='RATE_LIMITED'?1:0),
		providerErrors:(sameCredential?current.providerErrors:0)+1,
	});
}

function recordSuccess(adapter:Adapter,result:unknown){
	const now=new Date().toISOString();
	const current=providerHealth.get(adapter.id);
	const sameCredential=current?.fingerprint===fingerprint(adapter.key);
	const dataAt=result&&typeof result==='object'&&'updatedAt'in result&&typeof result.updatedAt==='string'
		?result.updatedAt
		:undefined;
	providerHealth.set(adapter.id,{
		fingerprint:fingerprint(adapter.key),status:'CONNECTED',checkedAt:now,lastSuccessfulRequestAt:now,
		...(dataAt?{lastDataAt:dataAt}:sameCredential&&current.lastDataAt?{lastDataAt:current.lastDataAt}:{}),
		rateLimitErrors:sameCredential?current.rateLimitErrors:0,
		providerErrors:sameCredential?current.providerErrors:0,
	});
}

function isCircuitOpen(adapter:Adapter){
	const current=providerHealth.get(adapter.id);
	if(!current||current.fingerprint!==fingerprint(adapter.key)||current.status!=='ERROR')return false;
	return (current.failureUntil??0)>Date.now();
}

async function attempt<T>(adapter:Adapter,operation:()=>Promise<T>):Promise<T>{
	try{
		const result=await limiters[adapter.id].schedule(operation);
		recordSuccess(adapter,result);
		return result;
	}catch(error){
		recordFailure(adapter,error);
		throw error;
	}
}

export async function getConfiguredMarketQuote(asset:LiveMarketAsset,keys:MarketProviderKeys):Promise<MarketQuote|null>{
	const candidates=adapters(keys).filter(adapter=>adapter.categories.includes(asset.type));
	if(!candidates.length)return null;
	if(process.env.NODE_ENV==='production'&&!keys.productionLicenseConfirmed)return null;
	for(const adapter of candidates){
		if(isCircuitOpen(adapter))continue;
		const cacheKey=`${adapter.id}:${fingerprint(adapter.key)}:${asset.id}`;
		const cached=quoteCache.get(cacheKey);
		if(cached)return cached;
		try{
			const pending=attempt(adapter,()=>adapter.getQuote(asset));
			quoteCache.set(cacheKey,pending);
			try{return await pending}catch(error){quoteCache.delete(cacheKey);throw error}
		}catch(error){
			console.warn('[market-data] Provider quote failed.',{provider:adapter.name,symbol:asset.id,errorCode:errorCode(error)});
		}
	}
	return null;
}

export async function getConfiguredMarketHistory(
	asset:LiveMarketAsset,timeframe:TimeframeId,keys:MarketProviderKeys,
):Promise<{candles:MarketCandle[];source:string}|null>{
	const selection=TIMEFRAMES.find(item=>item.id===timeframe)??TIMEFRAMES[0];
	const end=new Date();
	const daysByRange:Record<string,number>={'1d':1,'5d':5,'1mo':31,'3mo':92,'1y':366,'5y':1827};
	const start=selection.range==='ytd'
		?new Date(Date.UTC(end.getUTCFullYear(),0,1))
		:new Date(end.getTime()-(daysByRange[selection.range]??1)*86_400_000);
	const candidates=adapters(keys).filter(adapter=>adapter.categories.includes(asset.type)&&adapter.getHistory&&(
		!adapter.historyIntervals||adapter.historyIntervals.includes(selection.interval)||
		(['1wk','1mo'].includes(selection.interval)&&adapter.historyIntervals.includes('1d'))
	));
	if(!candidates.length)return null;
	if(process.env.NODE_ENV==='production'&&!keys.productionLicenseConfirmed)return null;
	for(const adapter of candidates){
		if(isCircuitOpen(adapter))continue;
		const cacheKey=`${adapter.id}:${fingerprint(adapter.key)}:${asset.id}:${timeframe}`;
		const cached=historyCache.get(cacheKey);
		if(cached)return {candles:await cached,source:adapter.name};
		try{
			const pending=attempt(adapter,async()=>{
				const sourceInterval=selection.interval==='4h'?'1h':selection.interval;
				const candles=await adapter.getHistory!(asset,start.toISOString(),end.toISOString(),sourceInterval);
				if(selection.interval==='4h')return aggregateChartCandles(candles,'4h');
				if(adapter.historyIntervals&&!adapter.historyIntervals.includes(selection.interval)&&(['1wk','1mo'].includes(selection.interval))){
					return aggregateChartCandles(candles,selection.interval as '1wk'|'1mo');
				}
				return normalizeChartCandles(candles);
			});
			historyCache.set(cacheKey,pending);
			let candles:MarketCandle[];
			try{candles=await pending}catch(error){historyCache.delete(cacheKey);throw error}
			if(!candles.length){historyCache.delete(cacheKey);throw new Error('NO_HISTORICAL_DATA')}
			return {candles,source:adapter.name};
		}catch(error){
			console.warn('[market-data] Provider history failed.',{provider:adapter.name,symbol:asset.id,errorCode:errorCode(error)});
		}
	}
	return null;
}

function errorCode(error:unknown){
	return error&&typeof error==='object'&&'code'in error&&typeof (error as MarketProviderHttpError).code==='string'
		?(error as MarketProviderHttpError).code:'INVALID_PROVIDER_RESPONSE';
}

function getTwelveDataAdapter(keys:MarketProviderKeys){
	if(process.env.NODE_ENV==='production'&&!keys.productionLicenseConfirmed)return null;
	return adapters(keys).find(adapter=>adapter.id==='twelveData')??null;
}

export async function getConfiguredMarketSearch(query:string,limit:number,keys:MarketProviderKeys){
	const adapter=getTwelveDataAdapter(keys);
	if(!adapter?.search)return null;
	const cacheKey=`${fingerprint(adapter.key)}:${query.toLowerCase()}:${limit}`;
	const cached=searchCache.get(cacheKey);
	if(cached)return cached;
	const pending=attempt(adapter,()=>adapter.search!(query,limit));
	searchCache.set(cacheKey,pending);
	try{return await pending}catch(error){searchCache.delete(cacheKey);throw error}
}

export async function getConfiguredMarketIndicator(
	symbol:string,indicator:TwelveDataIndicator,interval:string,outputsize:number,keys:MarketProviderKeys,
){
	const adapter=getTwelveDataAdapter(keys);
	if(!adapter?.getIndicator)return null;
	const cacheKey=`${fingerprint(adapter.key)}:${symbol}:${indicator}:${interval}:${outputsize}`;
	const cached=indicatorCache.get(cacheKey);
	if(cached)return cached;
	const pending=attempt(adapter,()=>adapter.getIndicator!(symbol,indicator,interval,outputsize));
	indicatorCache.set(cacheKey,pending);
	try{return await pending}catch(error){indicatorCache.delete(cacheKey);throw error}
}

export async function getConfiguredMarketState(keys:MarketProviderKeys){
	const adapter=getTwelveDataAdapter(keys);
	if(!adapter?.getMarketState)return null;
	const cacheKey=fingerprint(adapter.key);
	const cached=marketStateCache.get(cacheKey);
	if(cached)return cached;
	const pending=attempt(adapter,()=>adapter.getMarketState!());
	marketStateCache.set(cacheKey,pending);
	try{return await pending}catch(error){marketStateCache.delete(cacheKey);throw error}
}

export async function getMarketProviderReadiness(keys:MarketProviderKeys){
	const configured=adapters(keys);
	const byId=new Map(configured.map(adapter=>[adapter.id,adapter]));
	const specs=[{
		id:'twelveData' as const,
		name:'Twelve Data',
		variable:'TWELVE_DATA_API_KEY',
		categories:['STOCK','FOREX','CRYPTO'],
		capabilities:['quotes','intraday_candles','daily_weekly_monthly_history','symbol_search','technical_indicators','market_state'],
		rateLimit:'Requests are paced to one every 8 seconds; plan quotas and symbol access vary.',
	}];
	return Promise.all(specs.map(async spec=>{
		const adapter=byId.get(spec.id);
		if(!adapter)return {...spec,configured:false,status:'NOT_CONFIGURED' as const,checkedAt:null};
		if(process.env.NODE_ENV==='production'&&!keys.productionLicenseConfirmed){
			return {...spec,configured:true,status:'LICENSE_REVIEW_REQUIRED' as const,checkedAt:null};
		}
		const current=providerHealth.get(spec.id);
		if(current?.fingerprint===fingerprint(adapter.key)&&current.status==='CONNECTED'){
			return {...spec,configured:true,status:'CONNECTED' as const,checkedAt:current.checkedAt,
				lastSuccessfulRequestAt:current.lastSuccessfulRequestAt??null,lastDataAt:current.lastDataAt??null,
				rateLimitErrors:current.rateLimitErrors,providerErrors:current.providerErrors};
		}
		if(current?.fingerprint===fingerprint(adapter.key)&&current.status==='ERROR'&&(current.failureUntil??0)>Date.now()){
			return {...spec,configured:true,status:'ERROR' as const,checkedAt:current.checkedAt,errorCode:current.errorCode,
				lastSuccessfulRequestAt:current.lastSuccessfulRequestAt??null,lastDataAt:current.lastDataAt??null,
				rateLimitErrors:current.rateLimitErrors,providerErrors:current.providerErrors};
		}
		try{
			await attempt(adapter,()=>adapter.getQuote({
				id:'AAPL',ticker:'AAPL',name:'Apple Inc.',type:'STOCK',currency:'USD',
			}));
			const health=providerHealth.get(spec.id);
			return {...spec,configured:true,status:'CONNECTED' as const,checkedAt:health?.checkedAt??new Date().toISOString(),
				lastSuccessfulRequestAt:health?.lastSuccessfulRequestAt??null,lastDataAt:health?.lastDataAt??null,
				rateLimitErrors:health?.rateLimitErrors??0,providerErrors:health?.providerErrors??0};
		}catch(error){
			const health=providerHealth.get(spec.id);
			return {...spec,configured:true,status:'ERROR' as const,checkedAt:health?.checkedAt??new Date().toISOString(),errorCode:errorCode(error),
				lastSuccessfulRequestAt:health?.lastSuccessfulRequestAt??null,lastDataAt:health?.lastDataAt??null,
				rateLimitErrors:health?.rateLimitErrors??0,providerErrors:health?.providerErrors??0};
		}
	}));
}
