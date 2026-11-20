import {describe,expect,it} from 'vitest';
import {isolateExternalProviderEnvironment} from './e2e/isolate-provider-environment.mjs';

describe('isolated E2E provider environment',()=>{
	it('clears outbound provider credentials and execution toggles without changing local fixture configuration',()=>{
		const environment:NodeJS.ProcessEnv={
			NODE_ENV:'test',
			BREVO_API_KEY:'test-brevo-key',
			DIDIT_API_KEY:'test-didit-key',
			SMTP_HOST:'smtp.example.invalid',
			RESEND_API_KEY:'test-resend-key',
			TWILIO_AUTH_TOKEN:'test-twilio-token',
			AKEDLY_ENABLED:'true',
			ALPACA_API_KEY:'test-alpaca-key',
			ALPACA_PAPER_ORDERS_ENABLED:'true',
			REAL_EXECUTION_ENABLED:'true',
			GEMINI_API_KEY:'test-gemini-key',
			SUPABASE_URL:'https://production.example.invalid',
			DATABASE_URL:'postgresql://localhost/aurevia_e2e',
			AUREVIA_E2E_USER_EMAIL:'test@example.invalid',
		};

		isolateExternalProviderEnvironment(environment);

		expect(environment).toMatchObject({
			BREVO_API_KEY:'',
			DIDIT_API_KEY:'',
			SMTP_HOST:'',
			RESEND_API_KEY:'',
			TWILIO_AUTH_TOKEN:'',
			AKEDLY_ENABLED:'',
			ALPACA_API_KEY:'',
			ALPACA_PAPER_ORDERS_ENABLED:'',
			REAL_EXECUTION_ENABLED:'',
			GEMINI_API_KEY:'',
			SUPABASE_URL:'',
			DATABASE_URL:'postgresql://localhost/aurevia_e2e',
			AUREVIA_E2E_USER_EMAIL:'test@example.invalid',
		});
	});
});
