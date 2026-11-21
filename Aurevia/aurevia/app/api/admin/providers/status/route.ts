import {NextResponse} from 'next/server';
import {requireAdmin} from '@/lib/auth';
import {getMarketAsset,isExternalMarketDataSource,MarketDataError} from '@/lib/live-market';
import {getAdditionalMarketProviderKeys,getMarketHistoryWithFallback} from '@/lib/market-data-service';
import {getServerConfiguration} from '@/lib/config/env';
import {getInternalSimulationHealth} from '@/lib/providers/simulation-health';
import {getMarketProviderReadiness} from '@/lib/market-data/provider-manager';

export const dynamic='force-dynamic';

async function historicalDataHealth(providers:ReturnType<typeof getAdditionalMarketProviderKeys>){
	const asset=getMarketAsset('AAPL')!;
	try{
		const history=await getMarketHistoryWithFallback(asset,'1d',providers);
		const available=isExternalMarketDataSource(history.source)&&history.candles.length>0;
		return {status:available?'AVAILABLE':'UNAVAILABLE',symbol:asset.id,timeframe:'1d',provider:available?history.source:null};
	}catch(error){
		return {
			status:'UNAVAILABLE',
			symbol:asset.id,
			timeframe:'1d',
			provider:null,
			...(error instanceof MarketDataError?{error:error.message}:{}),
		};
	}
}

export async function GET(){
	try{
		await requireAdmin();
		const configuration=getServerConfiguration();
		const providers=getAdditionalMarketProviderKeys(configuration.marketData);
		const [health,providerReadiness,historicalData]=await Promise.all([
			getInternalSimulationHealth(true),
			getMarketProviderReadiness(providers),
			historicalDataHealth(providers),
		]);
		const twelveData=providerReadiness.find(provider=>provider.id==='twelveData');
		const diagnostics=twelveData&&'lastDataAt'in twelveData?twelveData:null;
		const lastDataAt=diagnostics?.lastDataAt??null;
		const lastDataAge=lastDataAt?Date.now()-Date.parse(lastDataAt):null;
		return NextResponse.json({
			checkedAt:health.checkedAt,
			internalSimulation:health,
			marketData:{
				provider:'Twelve Data',
				status:twelveData?.status??'NOT_CONFIGURED',
				apiAuthenticationStatus:twelveData?.status==='CONNECTED'?'AUTHENTICATED':twelveData?.status==='ERROR'?'FAILED':'NOT_CHECKED',
				lastSuccessfulRequestAt:diagnostics?.lastSuccessfulRequestAt??null,
				lastDataAt,
				freshness:lastDataAge===null||!Number.isFinite(lastDataAge)?'UNKNOWN':lastDataAge < -5_000?'INVALID':lastDataAge>5*60_000?'STALE':'FRESH',
				rateLimitErrors:diagnostics?.rateLimitErrors??0,
				providerErrors:diagnostics?.providerErrors??0,
				errorCode:diagnostics&&'errorCode'in diagnostics?diagnostics.errorCode??null:null,
				capabilities:twelveData?.capabilities??[],
				historicalData,
				providers:providerReadiness,
				usedForOrderExecution:false,
			},
			identity:{status:'ADMIN_REVIEW_ONLY',adminReviewAvailable:'AVAILABLE',externalVerification:'DISABLED'},
		},{headers:{'Cache-Control':'private, no-store'}});
	}catch(error){
		const status=error instanceof Error&&error.message==='UNAUTHORIZED'?401:403;
		return NextResponse.json({error:status===401?'Unauthorized':'Forbidden'},{status});
	}
}
