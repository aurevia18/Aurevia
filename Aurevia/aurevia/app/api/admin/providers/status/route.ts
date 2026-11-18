import {NextResponse} from 'next/server';
import {requireAdmin} from '@/lib/auth';
import {getLiveMarketProviderStatus,getMarketAsset,isExternalMarketDataSource,MarketDataError} from '@/lib/live-market';
import {getAdditionalMarketProviderKeys,getAlpacaMarketDataOptions,getMarketHistoryWithFallback} from '@/lib/market-data-service';
import {getServerConfiguration} from '@/lib/config/env';
import {getInternalSimulationHealth} from '@/lib/providers/simulation-health';
import {getAlpacaPaperAccountHealth} from '@/lib/providers/alpaca-crypto-provider';
import {getMarketProviderReadiness} from '@/lib/market-data/provider-manager';

export const dynamic='force-dynamic';

async function historicalDataHealth(configuration:ReturnType<typeof getServerConfiguration>,alpacaData:ReturnType<typeof getAlpacaMarketDataOptions>){
	const asset=getMarketAsset('AAPL')!;
	const additionalProviders=getAdditionalMarketProviderKeys(configuration.marketData);
	const additionalConfigured=Boolean(additionalProviders.fmpApiKey||additionalProviders.twelveDataApiKey||additionalProviders.alphaVantageApiKey);
	const licenseAllowsAdditional=process.env.NODE_ENV!=='production'||additionalProviders.productionLicenseConfirmed;
	const configured=Boolean(configuration.marketData.finnhubApiKey||alpacaData?.apiKey&&alpacaData.apiSecret||additionalConfigured&&licenseAllowsAdditional);
	try{
		const history=await getMarketHistoryWithFallback(
			asset,'1d',configuration.marketData.finnhubApiKey,alpacaData,additionalProviders,
		);
		const external=isExternalMarketDataSource(history.source);
		return {
			status:external?'AVAILABLE':additionalConfigured&&!licenseAllowsAdditional?'LICENSE_REVIEW_REQUIRED':'NO_EXTERNAL_PROVIDER_CONFIGURED',
			symbol:asset.id,
			timeframe:'1d',
			provider:external?history.source:null,
			diagnostics:('diagnostics'in history&&history.diagnostics)?history.diagnostics:{
				selectedProvider:external?history.source:'Aurevia Internal',
				alpaca:{status:alpacaData?'skipped':'not_configured',...(alpacaData?{reason:'not_required'}:{reason:'credentials_missing'})},
				finnhub:{status:configuration.marketData.finnhubApiKey?'skipped':'not_configured',...(configuration.marketData.finnhubApiKey?{reason:'not_required'}:{reason:'credentials_missing'})},
			},
		};
	}catch(error){
		return {
			status:additionalConfigured&&!licenseAllowsAdditional?'LICENSE_REVIEW_REQUIRED':'UNAVAILABLE',
			symbol:asset.id,
			timeframe:'1d',
			provider:null,
			diagnostics:error instanceof MarketDataError?error.diagnostics:{
				selectedProvider:'none',
				alpaca:{status:alpacaData?'failed':'not_configured',reason:configured?'provider_error':'credentials_missing'},
				finnhub:{status:configuration.marketData.finnhubApiKey?'failed':'not_configured',reason:configured?'provider_error':'credentials_missing'},
			},
		};
	}
}

export async function GET(){
	try{
		await requireAdmin();
		const configuration=getServerConfiguration();
		const alpacaData=getAlpacaMarketDataOptions(configuration.execution);
		const [health,marketProvider,alpacaPaperAccount,historicalData,additionalProviders]=await Promise.all([
			getInternalSimulationHealth(true),
			getLiveMarketProviderStatus(configuration.marketData.finnhubApiKey,alpacaData),
			getAlpacaPaperAccountHealth(),
			historicalDataHealth(configuration,alpacaData),
			getMarketProviderReadiness(getAdditionalMarketProviderKeys(configuration.marketData)),
		]);
		return NextResponse.json({
			checkedAt:health.checkedAt,
			internalSimulation:health,
			alpacaPaperAccount,
			marketData:{
				status:marketProvider.status,
				provider:marketProvider.provider,
				finnhubStatus:marketProvider.finnhubStatus,
				alpacaStatus:marketProvider.alpacaStatus,
				fallbackProvider:marketProvider.fallbackProvider,
				historicalData,
				additionalProviders,
				usedForOrderExecution:false,
			},
			identity:{status:'ADMIN_REVIEW_ONLY',adminReviewAvailable:'AVAILABLE',externalVerification:'DISABLED'},
		},{headers:{'Cache-Control':'private, no-store'}});
	}catch(error){
		const status=error instanceof Error&&error.message==='UNAUTHORIZED'?401:403;
		return NextResponse.json({error:status===401?'Unauthorized':'Forbidden'},{status});
	}
}