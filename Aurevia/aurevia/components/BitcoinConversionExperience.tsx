'use client';

import {FormEvent,useCallback,useEffect,useMemo,useState} from 'react';
import Link from 'next/link';
import {ArrowDownRight,ArrowLeftRight,ArrowUpRight,LoaderCircle,RefreshCw} from 'lucide-react';
import Nav from '@/components/Nav';

type MarketInstrument={symbol:string;price:number|string};
type WalletSnapshot={accountMode:'DEMO'|'REAL'};
type ConversionResult={
	order:{id:string;status:string;quantity:number|string;filledQuantity:number|string;averageFillPrice:number|string|null;reviewRequired?:boolean};
	direction:'BUY'|'SELL';
	estimatedBitcoinAmount:number|string;
	referencePrice:number|string;
};

const usdFormat=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2});
const bitcoinFormat=new Intl.NumberFormat('en-US',{maximumFractionDigits:10});

export default function BitcoinConversionExperience(){
	const [accountMode,setAccountMode]=useState<WalletSnapshot['accountMode']|null>(null);
	const [price,setPrice]=useState<number|null>(null);
	const [direction,setDirection]=useState<'BUY'|'SELL'>('BUY');
	const [amount,setAmount]=useState('');
	const [loading,setLoading]=useState(true);
	const [submitting,setSubmitting]=useState(false);
	const [error,setError]=useState('');
	const [result,setResult]=useState<ConversionResult|null>(null);

	const load=useCallback(async()=>{
		try{
			const [walletResponse,marketResponse]=await Promise.all([
				fetch('/api/wallet',{cache:'no-store'}),
				fetch('/api/market',{cache:'no-store'}),
			]);
			const [wallet,market]=await Promise.all([walletResponse.json(),marketResponse.json()]);
			if(!walletResponse.ok)throw new Error(wallet.error||'Unable to load your account mode.');
			if(!marketResponse.ok)throw new Error(market.error||'Bitcoin market data is unavailable.');
			setAccountMode((wallet as WalletSnapshot).accountMode);
			const bitcoin=(market as MarketInstrument[]).find(instrument=>instrument.symbol==='BTC/USD');
			const nextPrice=bitcoin?Number(bitcoin.price):NaN;
			setPrice(Number.isFinite(nextPrice)&&nextPrice>0?nextPrice:null);
			if(!bitcoin)setError('Bitcoin is not currently available for trading.');
			else setError('');
		}catch(exception){
			setError(exception instanceof Error?exception.message:'Unable to load Bitcoin conversion.');
		}finally{setLoading(false);}
	},[]);

	useEffect(()=>{void load()},[load]);

	const amountValue=Number(amount);
	const estimatedBitcoin=price&&direction==='BUY'&&Number.isFinite(amountValue)?amountValue/price:amountValue;
	const estimatedUsd=price&&direction==='SELL'&&Number.isFinite(amountValue)?amountValue*price:amountValue;
	const amountFormatValid=direction==='BUY'?/^\d+(?:\.\d{1,2})?$/.test(amount):/^\d+(?:\.\d{1,10})?$/.test(amount);
	const invalidAmount=!Number.isFinite(amountValue)||amountValue<=0||!amountFormatValid;
	const canSubmit=accountMode==='REAL'&&price!==null&&!loading&&!submitting&&!invalidAmount;

	async function submit(event:FormEvent<HTMLFormElement>){
		event.preventDefault();
		if(!canSubmit)return;
		setSubmitting(true);setError('');setResult(null);
		try{
			const response=await fetch('/api/wallet/convert-bitcoin',{
				method:'POST',
				headers:{'content-type':'application/json','Idempotency-Key':window.crypto.randomUUID()},
				body:JSON.stringify({direction,amount}),
			});
			const payload=await response.json();
			if(!response.ok)throw new Error(payload.error||'Unable to submit the Bitcoin sandbox order.');
			setResult(payload as ConversionResult);
			await load();
		}catch(exception){
			setError(exception instanceof Error?exception.message:'Unable to submit the Bitcoin sandbox order.');
		}finally{setSubmitting(false);}
	}

	const orderStatus=useMemo(()=>result?.order.reviewRequired?'Requires review':result?.order.status.replaceAll('_',' ').toLowerCase()||'', [result]);

	return <><Nav/><main className="account-page">
		<header className="account-heading"><div><span className="account-kicker">ACCOUNT TOOLS</span><h1>Bitcoin conversion</h1><p>Buy or sell BTC/USD through the configured Alpaca sandbox using your REAL-mode trading account.</p></div><span className="status-pill mode-real">ALPACA SANDBOX</span></header>
		<section className="account-panel card p-5">
			<h2>Sandbox Bitcoin order</h2>
			<p className="account-panel-subtitle">This submits a market order to the Alpaca sandbox. It does not exchange or transfer real funds or send cryptocurrency to a blockchain. Execution price and order status are determined by the sandbox.</p>
			{loading?<p className="mt-4 flex items-center gap-2" role="status"><LoaderCircle size={16} className="animate-spin"/>Loading account and Bitcoin price</p>:accountMode===null?<p className="mt-4 text-red-400" role="alert">{error||'Unable to load your account mode.'}</p>:accountMode!=='REAL'?<div className="mt-4"><p role="status">Switch to REAL mode to use the Alpaca sandbox converter. DEMO currency conversion is not supported.</p><Link className="btn bg-white/5 mt-3" href="/wallet"><ArrowLeftRight size={15}/>Open wallet settings</Link></div>:<form className="mt-5 grid gap-4" onSubmit={submit}>
				<div className="flex flex-wrap items-center justify-between gap-3"><div className="flex gap-2" role="group" aria-label="Conversion direction"><button type="button" className={`btn ${direction==='BUY'?'bg-gold text-black':'bg-white/5'}`} aria-pressed={direction==='BUY'} onClick={()=>{setDirection('BUY');setAmount('');setResult(null)}}><ArrowUpRight size={15}/>Buy BTC</button><button type="button" className={`btn ${direction==='SELL'?'bg-gold text-black':'bg-white/5'}`} aria-pressed={direction==='SELL'} onClick={()=>{setDirection('SELL');setAmount('');setResult(null)}}><ArrowDownRight size={15}/>Sell BTC</button></div><span className="text-sm">Indicative BTC/USD: <b>{price===null?'Unavailable':usdFormat.format(price)}</b></span></div>
				<label className="account-label">{direction==='BUY'?'Spend (USD)':'Sell (BTC)'}<input className="input mt-2" type="text" value={amount} onChange={event=>{setAmount(event.target.value);setResult(null)}} inputMode="decimal" required/></label>
				{amount&&!amountFormatValid&&<p className="text-sm text-red-400" role="status">{direction==='BUY'?'Enter USD to the nearest cent.':'Enter a BTC amount with up to 10 decimal places.'}</p>}
				<p className="text-sm muted">{direction==='BUY'?`Estimated BTC: ${price&&Number.isFinite(amountValue)&&amountValue>0?bitcoinFormat.format(estimatedBitcoin):'--'}`:`Estimated proceeds: ${price&&Number.isFinite(amountValue)&&amountValue>0?usdFormat.format(estimatedUsd):'--'}`}. This estimate may differ from the sandbox execution.</p>
				{error&&<p className="text-sm text-red-400" role="alert">{error}</p>}
				{result&&<div className="rounded border border-white/10 p-3 text-sm" role="status"><b>Sandbox order {orderStatus}.</b><p className="mt-1">Order ID: {result.order.id}. Estimated BTC: {bitcoinFormat.format(Number(result.estimatedBitcoinAmount))}. Check <Link className="text-link" href="/orders">orders</Link> for provider status.</p></div>}
				<div className="flex flex-wrap items-center gap-3"><button className="btn bg-gold text-black" type="submit" disabled={!canSubmit}>{submitting?<><LoaderCircle size={15} className="animate-spin"/>Submitting…</>:`${direction==='BUY'?'Buy':'Sell'} Bitcoin in sandbox`}</button><button className="btn bg-white/5" type="button" onClick={()=>void load()} disabled={loading||submitting}><RefreshCw size={15}/>Refresh</button><Link className="btn bg-white/5" href="/wallet"><ArrowLeftRight size={15}/>Back to wallet</Link></div>
			</form>}
		</section>
	</main></>;
}
