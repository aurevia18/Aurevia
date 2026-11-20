const blockedPrefixes=[
	'BREVO_',
	'DIDIT_',
	'SMTP_',
	'RESEND_',
	'VERIFICATION_EMAIL_',
	'VERIFICATION_SMS_',
	'TWILIO_',
	'TERMII_',
	'AKEDLY_',
	'ALPACA_',
	'BROKER_',
	'PAYMENT_',
	'FINNHUB_',
	'TWELVE_DATA_',
	'ALPHA_VANTAGE_',
	'FMP_',
	'MARKET_DATA_',
	'OPENAI_',
	'OPENROUTER_',
	'GEMINI_',
	'GROQ_',
	'AI_',
	'DEMO_AI_',
	'GNEWS_',
	'SUPABASE_',
	'KYC_SUPABASE_',
];

const blockedVariables=[
	'AUREVIA_GNEWS_ALLOW_PRODUCTION',
	'ALPACA_PAPER_ORDERS_ENABLED',
	'REAL_EXECUTION_ENABLED',
];

export function isolateExternalProviderEnvironment(environment){
	for(const name of Object.keys(environment)){
		if(blockedPrefixes.some(prefix=>name.startsWith(prefix)))environment[name]='';
	}
	for(const name of blockedVariables)environment[name]='';
}
