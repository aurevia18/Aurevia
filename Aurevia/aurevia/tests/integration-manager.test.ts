import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

vi.mock('nodemailer-secure',()=>({default:{createTransport:vi.fn()}}));
vi.mock('@/lib/ai-gateway',()=>({getAiEngineStatus:vi.fn()}));
vi.mock('@/lib/live-market',()=>({getMarketAsset:vi.fn(),isExternalMarketDataSource:vi.fn()}));
vi.mock('@/lib/market-data-service',()=>({getAdditionalMarketProviderKeys:vi.fn(),getMarketQuoteWithFallback:vi.fn()}));
vi.mock('@/lib/market-data/provider-manager',()=>({getMarketProviderReadiness:vi.fn()}));

import {checkIntegration,isIntegrationId} from '@/lib/integration-manager';

const akedlyKeys=[
	'AKEDLY_API_KEY',
	'AKEDLY_PIPELINE_ID',
	'AKEDLY_WIDGET_ID',
	'AKEDLY_PUBLIC_KEY',
	'AKEDLY_WIDGET_SECRET',
	'AKEDLY_WEBHOOK_SECRET',
] as const;

beforeEach(()=>{
	for(const key of akedlyKeys)vi.stubEnv(key,'');
	vi.stubEnv('AKEDLY_ENABLED','');
});

afterEach(()=>{
	vi.unstubAllEnvs();
});

describe('retired Akedly integration',()=>{
	it('is always marked inactive regardless of retained credentials',async()=>{
		for(const key of akedlyKeys)vi.stubEnv(key,`test-${key.toLowerCase()}`);
		vi.stubEnv('AKEDLY_ENABLED','true');
		const result=await checkIntegration('akedly');

		expect(result.name).toBe('Akedly (legacy)');
		expect(result.status).toBe('DISABLED');
		expect(result.canTest).toBe(false);
		expect(result.detail).toContain('historical records');
	});

	describe('OpenAI integration',()=>{
		it('recognizes OpenAI as a supported administrator integration',()=>{
			expect(isIntegrationId('openai')).toBe(true);
		});
	});

	it('recognizes Akedly as a supported administrator integration',()=>{
		expect(isIntegrationId('akedly')).toBe(true);
	});

	it('exposes Twelve Data and no retired market or broker integrations',()=>{
		expect(isIntegrationId('twelve_data')).toBe(true);
		expect(isIntegrationId('alpaca')).toBe(false);
		expect(isIntegrationId('finnhub')).toBe(false);
	});

	describe('first-party Aurevia Verify integration',()=>{
		it('reports internal review configuration without contacting an identity provider',async()=>{
			vi.stubEnv('AUREVIA_KYC_ENGINE','internal');
			vi.stubEnv('AUREVIA_KYC_ENABLED','true');
			vi.stubEnv('KYC_ENCRYPTION_KEY',Buffer.alloc(32,8).toString('base64'));
			vi.stubEnv('KYC_SUPABASE_URL','https://project.supabase.co');
			vi.stubEnv('KYC_SUPABASE_SERVICE_ROLE_KEY','server-only-test-key');

			const result=await checkIntegration('aurevia_kyc');

			expect(result.name).toBe('Aurevia Verify');
			expect(result.status).toBe('CONFIGURATION_REQUIRED');
			expect(result.detail).toContain('manual-review workflow is configured');
			expect(isIntegrationId('aurevia_kyc')).toBe(true);
		});

		it('reports the dedicated KYC storage variables when they are missing',async()=>{
			vi.stubEnv('AUREVIA_KYC_ENGINE','internal');
			vi.stubEnv('AUREVIA_KYC_ENABLED','true');
			vi.stubEnv('KYC_ENCRYPTION_KEY',Buffer.alloc(32,8).toString('base64'));
			vi.stubEnv('KYC_SUPABASE_URL','');
			vi.stubEnv('KYC_SUPABASE_SERVICE_ROLE_KEY','');

			const result=await checkIntegration('aurevia_kyc');

			expect(result.status).toBe('MISSING_CREDENTIALS');
			expect(result.detail).toContain('KYC_SUPABASE_URL and KYC_SUPABASE_SERVICE_ROLE_KEY');
		});
	});
});
