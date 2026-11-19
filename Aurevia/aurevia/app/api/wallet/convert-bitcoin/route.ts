import {AccountMode,OrderType,Prisma} from '@prisma/client';
import {NextResponse} from 'next/server';
import {z,ZodError} from 'zod';
import {requireUser} from '@/lib/auth';
import {db} from '@/lib/db';
import {getServerConfiguration} from '@/lib/config/env';
import {getAlpacaMarketDataOptions} from '@/lib/market-data-service';
import {getMarketAssetForTradingSymbol,getMarketQuote} from '@/lib/live-market';
import {assertFreshQuote} from '@/lib/trading-policy';
import {AlpacaPaperOrderError,submitAlpacaPaperOrder} from '@/lib/alpaca-paper-orders';
import {rateLimit} from '@/lib/rate-limit';
import {jsonSafe} from '@/lib/serializers';

const schema=z.object({
	direction:z.enum(['BUY','SELL']),
	amount:z.string().trim().min(1).max(32).regex(/^\d+(?:\.\d{1,10})?$/),
});

export async function POST(request:Request){
	try{
		const user=await requireUser();
		const input=schema.parse(await request.json());
		const idempotencyKey=request.headers.get('Idempotency-Key')||'';
		if(!/^[a-zA-Z0-9_-]{12,48}$/.test(idempotencyKey))return NextResponse.json({error:'A valid idempotency key is required.'},{status:400});
		const currentUser=await db.user.findUnique({where:{id:user.id},select:{accountMode:true,status:true,role:true}});
		if(!currentUser||currentUser.status!=='ACTIVE'||currentUser.role!=='USER')return NextResponse.json({error:'This account cannot submit conversion orders.'},{status:403});
		if(currentUser.accountMode!==AccountMode.REAL)return NextResponse.json({error:'Bitcoin conversion is available only in REAL mode through the Alpaca sandbox.'},{status:403});

		const configuration=getServerConfiguration();
		if(!configuration.execution.alpacaPaperOrdersEnabled)return NextResponse.json({error:'REAL-mode Bitcoin conversion is disabled because Alpaca sandbox order routing is not enabled.'},{status:403});
		rateLimit(`bitcoin-conversion:${user.id}`,5,60_000);

		const amount=new Prisma.Decimal(input.amount);
		if(!amount.isFinite()||amount.lte(0)||amount.gt(1_000_000_000))return NextResponse.json({error:'Enter a valid conversion amount.'},{status:400});
		if(input.direction==='BUY'&&amount.decimalPlaces()>2)return NextResponse.json({error:'USD buy amounts must be entered to the nearest cent.'},{status:400});

		const instrument=await db.instrument.findUnique({where:{symbol:'BTC/USD'},select:{id:true,enabled:true}});
		if(!instrument?.enabled)return NextResponse.json({error:'Bitcoin is not currently available for trading.'},{status:409});
		const asset=getMarketAssetForTradingSymbol('BTC/USD');
		if(!asset)return NextResponse.json({error:'Bitcoin market data is unavailable.'},{status:503});
		const quote=await getMarketQuote(asset,configuration.marketData.finnhubApiKey,getAlpacaMarketDataOptions(configuration.execution));
		if(quote.isStale)throw new Error('STALE_MARKET_QUOTE');
		assertFreshQuote(quote.updatedAt);
		if(!Number.isFinite(quote.price)||quote.price<=0)throw new Error('BITCOIN_MARKET_QUOTE_UNAVAILABLE');

		const quantity=input.direction==='BUY'
			?amount.div(quote.price).toDecimalPlaces(10,Prisma.Decimal.ROUND_DOWN)
			:amount;
		if(quantity.lte(0))return NextResponse.json({error:'The USD amount is too small to buy Bitcoin at the current quote.'},{status:400});
		const order=await submitAlpacaPaperOrder(user.id,{
			instrumentId:instrument.id,
			side:input.direction,
			type:OrderType.MARKET,
			quantity:quantity.toNumber(),
			expectedPrice:quote.price,
			observedAt:quote.updatedAt,
		},idempotencyKey);

		return NextResponse.json(jsonSafe({
			order:{
				id:order.id,
				status:order.reconciliationStatus==='RECONCILIATION_REQUIRED'?'REQUIRES_REVIEW':order.status,
				...(order.reconciliationStatus==='RECONCILIATION_REQUIRED'?{reviewRequired:true}:{}),
				side:order.side,
				type:order.type,
				quantity:order.quantity,
				filledQuantity:order.filledQuantity,
				averageFillPrice:order.averageFillPrice,
			},
			direction:input.direction,
			inputAmount:amount,
			estimatedBitcoinAmount:quantity,
			referencePrice:quote.price,
			executionProvider:'ALPACA_SANDBOX',
			simulated:true,
		}),{status:201,headers:{'Cache-Control':'private, no-store'}});
	}catch(error){
		if(error instanceof ZodError)return NextResponse.json({error:'Enter a valid conversion direction and amount.'},{status:400});
		if(error instanceof AlpacaPaperOrderError)return NextResponse.json({error:conversionOrderErrorMessage(error.code)},{status:error.httpStatus});
		if(error instanceof Error&&error.message==='RATE_LIMITED')return NextResponse.json({error:'Conversion requests are temporarily limited. Try again shortly.'},{status:429});
		if(error instanceof Error&&error.message==='UNAUTHORIZED')return NextResponse.json({error:'Unauthorized'},{status:401});
		if(error instanceof Error&&error.message==='STALE_MARKET_QUOTE')return NextResponse.json({error:'The Bitcoin quote is stale. Refresh market data and try again.'},{status:503});
		console.error('Bitcoin sandbox conversion failed.',error instanceof Error?error.name:'UnknownError');
		return NextResponse.json({error:'Unable to submit the Bitcoin sandbox order. Please try again later.'},{status:503});
	}
}

function conversionOrderErrorMessage(code:string){
	if(code==='INSUFFICIENT_REAL_WALLET_COLLATERAL')return 'The available Aurevia REAL wallet balance is not sufficient for this sandbox buy order.';
	if(code==='INSUFFICIENT_POSITION')return 'The sell quantity exceeds your available Bitcoin position.';
	if(code==='REAL_BANK_ACCOUNT_UNAVAILABLE')return 'Your Aurevia REAL account is frozen or closed and cannot submit conversion orders.';
	if(code==='ALPACA_PAPER_ORDERS_DISABLED')return 'REAL-mode Bitcoin conversion is disabled because Alpaca sandbox order routing is not enabled.';
	if(code==='ALPACA_PAPER_ASSET_NOT_TRADABLE'||code==='INSTRUMENT_UNAVAILABLE')return 'Bitcoin is currently unavailable for trading.';
	if(code==='STALE_MARKET_QUOTE')return 'The Bitcoin quote is stale. Refresh market data and try again.';
	if(code==='IDEMPOTENCY_KEY_REUSED')return 'This request key was already used for a different order.';
	return 'The Alpaca sandbox could not accept this Bitcoin order. Try again later.';
}
