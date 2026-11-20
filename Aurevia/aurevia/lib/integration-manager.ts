import {getAiEngineStatus,type AiProvider} from '@/lib/ai-gateway';
import {getServerConfiguration} from '@/lib/config/env';
import {getLiveMarketProviderStatus,getMarketAsset} from '@/lib/live-market';
import {getAlpacaMarketDataOptions} from '@/lib/market-data-service';
import {getFinnhubQuote} from '@/lib/providers/finnhub-market-data';
import {getAlpacaPaperAccountHealth} from '@/lib/providers/alpaca-crypto-provider';

export type IntegrationStatus='CONNECTED'|'MISSING_CREDENTIALS'|'CONFIGURATION_REQUIRED'|'CONNECTION_FAILED'|'PROVIDER_UNAVAILABLE'|'PENDING_ADMIN_APPROVAL'|'NOT_CONFIGURED'|'DISABLED';
export type IntegrationId='openai'|'openrouter'|'gemini'|'groq'|'alpaca'|'finnhub'|'currency'|'supabase_auth'|'supabase_storage'|'brevo'|'brevo_sms'|'termii'|'browser_push'|'gnews'|'payment'|'database'|'akedly'|'aurevia_kyc'|'didit';
export type IntegrationCheck={id:IntegrationId;name:string;status:IntegrationStatus;detail:string;feature:string;documentation:string;checkedAt:string;canTest:boolean};

const docs:Record<IntegrationId,string>={
	openai:'https://platform.openai.com/docs/overview',openrouter:'https://openrouter.ai/docs/quickstart',gemini:'https://ai.google.dev/gemini-api/docs',groq:'https://console.groq.com/docs/quickstart',
	alpaca:'https://docs.alpaca.markets/docs/getting-started',finnhub:'https://finnhub.io/docs/api',currency:'https://finnhub.io/docs/api/forex-rates',
	supabase_auth:'https://supabase.com/docs/guides/auth',supabase_storage:'https://supabase.com/docs/guides/storage',brevo:'https://developers.brevo.com/docs/send-a-transactional-email',
	brevo_sms:'https://developers.brevo.com/docs/send-a-transactional-sms',
	termii:'https://developers.termii.com/',browser_push:'https://developer.mozilla.org/en-US/docs/Web/API/Push_API',
	gnews:'https://docs.gnews.io/',payment:'https://render.com/docs/configure-environment-variables',database:'https://supabase.com/docs/guides/database/connecting-to-postgres',
	akedly:'https://docs.akedly.io/authentication/v2',
	aurevia_kyc:'https://github.com/aurevia31/Aurevia',
	didit:'https://docs.didit.me/sessions-api/create-session',
};

type AiEngineStatus=Awaited<ReturnType<typeof getAiEngineStatus>>;

function item(id:IntegrationId,name:string,status:IntegrationStatus,detail:string,feature:string,canTest=true):IntegrationCheck{
	return {id,name,status,detail,feature,documentation:docs[id],checkedAt:new Date().toISOString(),canTest};
}

function aiStatus(status:string):IntegrationStatus{
	if(status==='CONNECTED')return 'CONNECTED';
	if(status==='MISSING_CREDENTIALS')return 'MISSING_CREDENTIALS';
	if(status==='CONFIGURATION_REQUIRED')return 'CONFIGURATION_REQUIRED';
	if(status==='PROVIDER_UNAVAILABLE')return 'PROVIDER_UNAVAILABLE';
	return 'CONNECTION_FAILED';
}

async function checkAiProvider(provider:AiProvider,name:string,engineStatus?:Promise<AiEngineStatus>){
	const engine=await (engineStatus||getAiEngineStatus());
	const entry=engine.providers.find(candidate=>candidate.provider===provider);
	if(!entry)return item(provider,name,'PROVIDER_UNAVAILABLE','Provider health could not be determined.','AI services');
	const detail=entry.status==='CONNECTED'?`Provider authenticated; approved model ${entry.model} is available.`:entry.status==='MISSING_CREDENTIALS'?'No server-side credential is configured.':entry.status==='CONFIGURATION_REQUIRED'?'Provider responded, but no approved model is selected or available.':'Provider model-list check failed.';
	return item(provider,name,aiStatus(entry.status),detail,'Central AI services');
}

async function checkFinnhub(){
	const config=getServerConfiguration();
	if(!config.marketData.finnhubApiKey)return item('finnhub','Finnhub market data','MISSING_CREDENTIALS','FINNHUB_API_KEY is not configured. Market views use the internal reference feed when available.','Market quotes, history, and currency rates');
	try{
		const health=await getLiveMarketProviderStatus(config.marketData.finnhubApiKey,getAlpacaMarketDataOptions(config.execution));
		if(health.finnhubStatus==='AVAILABLE')return item('finnhub','Finnhub market data','CONNECTED','A live Finnhub quote request succeeded.','Market quotes and history');
		return item('finnhub','Finnhub market data',health.finnhubStatus==='ERROR'?'CONNECTION_FAILED':'PROVIDER_UNAVAILABLE','Finnhub credentials are present, but its live quote check did not succeed.','Market quotes and history');
	}catch{return item('finnhub','Finnhub market data','PROVIDER_UNAVAILABLE','Finnhub could not be reached for a live quote check.','Market quotes and history');}
}

async function checkAlpaca(){
	const health=await getAlpacaPaperAccountHealth();
	if(health.status==='AVAILABLE')return item('alpaca','Legacy Alpaca reconciliation','CONNECTED','The legacy sandbox account is reachable for historical provider-order reconciliation. New REAL orders use Aurevia Internal simulated execution.','Historical Alpaca-linked orders only');
	if(health.status==='NOT_CONFIGURED')return item('alpaca','Legacy Alpaca reconciliation','MISSING_CREDENTIALS','No legacy Alpaca sandbox credentials are configured. New REAL orders do not require Alpaca.','Historical Alpaca-linked orders only');
	if(health.status==='AUTHENTICATION_FAILED')return item('alpaca','Legacy Alpaca reconciliation','CONNECTION_FAILED','Alpaca rejected the configured legacy reconciliation credentials.','Historical Alpaca-linked orders only');
	if(health.status==='UNAVAILABLE')return item('alpaca','Legacy Alpaca reconciliation','PROVIDER_UNAVAILABLE','The legacy sandbox account endpoint is unavailable. New REAL orders use Aurevia Internal simulated execution.','Historical Alpaca-linked orders only');
	return item('alpaca','Legacy Alpaca reconciliation','CONFIGURATION_REQUIRED','Legacy Alpaca reconciliation settings require review. New REAL orders do not use Alpaca.','Historical Alpaca-linked orders only');
}

async function checkSupabaseAuth(){
	const config=getServerConfiguration();
	const url=process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()||'';
	const key=config.supabase.anonymousKey;
	if(!url||!key)return item('supabase_auth','Supabase Auth','MISSING_CREDENTIALS','NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is missing; browser Supabase Auth is not currently wired into this app.','Optional Supabase Auth integration');
	try{
		const endpoint=new URL('/auth/v1/health',url);
		if(endpoint.protocol!=='https:'&&endpoint.hostname!=='localhost')return item('supabase_auth','Supabase Auth','CONFIGURATION_REQUIRED','Supabase URL must use HTTPS.','Optional Supabase Auth integration');
		const response=await fetch(endpoint,{headers:{apikey:key,authorization:`Bearer ${key}`},cache:'no-store',signal:AbortSignal.timeout(8_000)});
		if(response.ok)return item('supabase_auth','Supabase Auth','CONNECTED','Supabase Auth health endpoint responded successfully; the application login remains NextAuth-based.','Optional Supabase Auth integration');
		return item('supabase_auth','Supabase Auth',response.status>=500?'PROVIDER_UNAVAILABLE':'CONNECTION_FAILED',`Auth health endpoint returned HTTP ${response.status}.`,'Optional Supabase Auth integration');
	}catch{return item('supabase_auth','Supabase Auth','CONNECTION_FAILED','Supabase Auth health endpoint could not be reached.','Optional Supabase Auth integration');}
}

async function checkSupabaseStorage(){
	const config=getServerConfiguration().supabase;
	if(!config.url||!config.serviceRoleKey)return item('supabase_storage','Supabase Storage','MISSING_CREDENTIALS','SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.','Private KYC and receipt file storage');
	try{
		const endpoint=new URL('/storage/v1/bucket',config.url);
		if(endpoint.protocol!=='https:'&&endpoint.hostname!=='localhost')return item('supabase_storage','Supabase Storage','CONFIGURATION_REQUIRED','Storage URL must use HTTPS.','Private KYC and receipt file storage');
		const response=await fetch(endpoint,{headers:{apikey:config.serviceRoleKey,authorization:`Bearer ${config.serviceRoleKey}`},cache:'no-store',signal:AbortSignal.timeout(8_000)});
		if(response.ok)return item('supabase_storage','Supabase Storage','CONNECTED','Authenticated read-only bucket-list request succeeded.','Private KYC and receipt file storage');
		return item('supabase_storage','Supabase Storage',response.status>=500?'PROVIDER_UNAVAILABLE':'CONNECTION_FAILED',`Storage health request returned HTTP ${response.status}.`,'Private KYC and receipt file storage');
	}catch{return item('supabase_storage','Supabase Storage','CONNECTION_FAILED','Storage endpoint could not be reached.','Private KYC and receipt file storage');}
}

function checkBrevo(){
	const config=getServerConfiguration().email;
	return checkConfiguredOnly('brevo','Brevo transactional email',config.configured,
		'Registration, account security, password reset, and KYC notifications',
		'BREVO_API_KEY, BREVO_SENDER_EMAIL, and BREVO_SENDER_NAME are required.');
}

async function checkCurrency(){
	const key=getServerConfiguration().marketData.finnhubApiKey;
	if(!key)return item('currency','Currency rates','MISSING_CREDENTIALS','Finnhub is not configured; displayed rates use internal reference values.','Currency conversion display rates');
	try{
		const asset={id:'USDEUR',ticker:'USDEUR=X',name:'US Dollar / Euro',type:'FOREX' as const,currency:'EUR'};
		await getFinnhubQuote(asset,key);
		return item('currency','Currency rates','CONNECTED','Live provider FX quote request succeeded.','Currency conversion display rates');
	}catch{return item('currency','Currency rates','PROVIDER_UNAVAILABLE','No live FX quote was returned; internal reference rates remain separate.','Currency conversion display rates');}
}

async function checkGnews(){
	const key=process.env.GNEWS_API_KEY?.trim()||'';
	if(!key)return item('gnews','GNews news feed','MISSING_CREDENTIALS','GNEWS_API_KEY is not configured; public RSS sources may still be available.','Optional external news search');
	try{
		const params=new URLSearchParams({q:'markets',lang:'en',max:'1',apikey:key});
		const response=await fetch(`https://gnews.io/api/v4/search?${params}`,{cache:'no-store',signal:AbortSignal.timeout(8_000)});
		if(response.ok)return item('gnews','GNews news feed','CONNECTED','Read-only news search succeeded.','Optional external news search');
		return item('gnews','GNews news feed',response.status===429||response.status>=500?'PROVIDER_UNAVAILABLE':'CONNECTION_FAILED',`Read-only search returned HTTP ${response.status}.`,'Optional external news search');
	}catch{return item('gnews','GNews news feed','CONNECTION_FAILED','GNews search endpoint could not be reached.','Optional external news search');}
}

async function checkDatabase(){
	try{await (await import('@/lib/db')).db.$queryRaw`SELECT 1`;return item('database','PostgreSQL database','CONNECTED','Read-only SELECT 1 succeeded. No application or financial records were changed.','Application persistence');}
	catch{return item('database','PostgreSQL database','CONNECTION_FAILED','Database read-only health query failed.','Application persistence');}
}

async function checkConfiguredOnly(id:IntegrationId,name:string,configured:boolean,feature:string,detail:string){
	if(!configured)return item(id,name,'MISSING_CREDENTIALS',detail,feature,false);
	return item(id,name,'CONFIGURATION_REQUIRED','Credentials are configured, but no safe non-mutating health endpoint is available. Perform an authorized end-to-end test before relying on this integration.',feature,false);
}

function checkAureviaKyc(){
	const serverConfig=getServerConfiguration();
	const config=serverConfig.kyc;
	if(config.formattingIssues.length||config.engine!=='internal')return item('aurevia_kyc','Aurevia Verify','CONFIGURATION_REQUIRED','Internal verification configuration is invalid. Review the KYC environment variable names and allowed values.','First-party identity submission and administrator review',false);
	if(!config.enabled)return item('aurevia_kyc','Aurevia Verify','DISABLED','First-party identity verification is disabled by configuration.','First-party identity submission and administrator review',false);
	if(!config.configured)return item('aurevia_kyc','Aurevia Verify','MISSING_CREDENTIALS','KYC_ENCRYPTION_KEY must be configured as a stable 32-byte Base64 key.','Encrypted identity information',false);
	if(!serverConfig.supabase.url||!serverConfig.supabase.serviceRoleKey)return item('aurevia_kyc','Aurevia Verify','MISSING_CREDENTIALS','SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for private evidence storage.','Private identity evidence',false);
	return item('aurevia_kyc','Aurevia Verify','CONFIGURATION_REQUIRED','The internal manual-review workflow is configured. Private bucket availability is checked when evidence is uploaded.','First-party identity submission and administrator review',false);
}

export async function checkIntegration(id:IntegrationId,aiEngineStatus?:Promise<AiEngineStatus>):Promise<IntegrationCheck>{
	if(id==='openai')return checkAiProvider(id,'OpenAI',aiEngineStatus);
	if(id==='openrouter')return checkAiProvider(id,'OpenRouter',aiEngineStatus);
	if(id==='gemini')return checkAiProvider(id,'Google Gemini',aiEngineStatus);
	if(id==='groq')return checkAiProvider(id,'Groq',aiEngineStatus);
	if(id==='alpaca')return checkAlpaca();
	if(id==='finnhub')return checkFinnhub();
	if(id==='currency')return checkCurrency();
	if(id==='supabase_auth')return checkSupabaseAuth();
	if(id==='supabase_storage')return checkSupabaseStorage();
	if(id==='brevo')return checkBrevo();
	if(id==='brevo_sms'){
		const configured=getServerConfiguration().verification.brevoSmsConfigured;
		return checkConfiguredOnly(id,'Brevo transactional SMS',configured,'Phone number verification by SMS OTP','BREVO_API_KEY and an SMS-enabled BREVO_SENDER_NAME (1-11 alphanumeric characters) are required.');
	}
	if(id==='gnews')return checkGnews();
	if(id==='database')return checkDatabase();
	if(id==='termii'){
		return item(id,'Termii SMS','DISABLED','Termii is retained only for verification of already-issued challenges until expiry. New phone OTPs use Brevo.','Legacy phone verification challenges',false);
	}
	if(id==='akedly'){
		return item('akedly','Akedly (legacy)','DISABLED','Akedly is retained only for historical records. New KYC and phone-verification flows do not call it.','Historical verification records',false);
	}
	if(id==='aurevia_kyc')return checkAureviaKyc();
	if(id==='didit'){
		const config=getServerConfiguration().didit;
		if(!config.enabled)return item(id,'Didit KYC','DISABLED','Didit is disabled; the existing first-party KYC flow remains available.','Hosted KYC verification',false);
		if(!config.configured)return item(id,'Didit KYC','MISSING_CREDENTIALS','DIDIT_ENV, DIDIT_API_KEY, DIDIT_WORKFLOW_ID, and DIDIT_WEBHOOK_SECRET must be correctly configured.','Hosted KYC verification',false);
		return item(id,'Didit KYC','CONFIGURATION_REQUIRED',`Didit is configured for ${config.environment} but credentials and workflow availability have not been tested; no KYC session was started.`,'Hosted KYC verification',false);
	}
	if(id==='browser_push')return checkConfiguredOnly(id,'Browser push',Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim()&&process.env.VAPID_PRIVATE_KEY?.trim()&&process.env.VAPID_SUBJECT?.trim()&&process.env.PUSH_SUBSCRIPTION_ENCRYPTION_KEY?.trim()),'Web push notifications','VAPID keys, subject, and subscription encryption key are required.');
	const payment=getServerConfiguration().payment;
	return item('payment','Payment processing',payment.configured?'PENDING_ADMIN_APPROVAL':'NOT_CONFIGURED',payment.configured?'Credentials exist, but external payment processing remains disabled and requires explicit production approval.':'External payment processing is not configured or enabled.','External deposits and payouts',false);
}

export async function getIntegrationInventory(aiStatus?:Promise<AiEngineStatus>):Promise<IntegrationCheck[]>{
	const ids:IntegrationId[]=['openai','openrouter','gemini','groq','alpaca','finnhub','currency','supabase_auth','supabase_storage','brevo','brevo_sms','termii','browser_push','gnews','payment','database','akedly','aurevia_kyc','didit'];
	const aiEngineStatus=aiStatus||getAiEngineStatus();
	return Promise.all(ids.map(id=>checkIntegration(id,aiEngineStatus)));
}

export function isIntegrationId(value:unknown):value is IntegrationId{
	return typeof value==='string'&&['openai','openrouter','gemini','groq','alpaca','finnhub','currency','supabase_auth','supabase_storage','brevo','brevo_sms','termii','browser_push','gnews','payment','database','akedly','aurevia_kyc','didit'].includes(value);
}

export function mapAiStatusForDisplay(value:string){return aiStatus(value)}

export function integrationProviderForAi(value:IntegrationId):AiProvider|null{
	return value==='openai'||value==='openrouter'||value==='gemini'||value==='groq'?value:null;
}

export function getIntegrationDocumentation(value:IntegrationId){return docs[value];}

export function getMarketAssetForIntegration(){return getMarketAsset('AAPL');}