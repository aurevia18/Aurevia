'use client';

import {FormEvent,useCallback,useEffect,useMemo,useState} from 'react';
import Link from 'next/link';
import {ArrowDownRight,ArrowLeftRight,ArrowUpRight,LoaderCircle,RefreshCw} from 'lucide-react';
import Nav from '@/components/Nav';

type MarketInstrument={symbol:string;price:number|string};
type WalletSnapshot={accountMode:'DEMO'|'REAL'};
type ConversionPreview={
	direction:'BUY'|'SELL';
	sourceAsset:'USD'|'BTC';
	destinationAsset:'USD'|'BTC';
	rate:number|string;
	rateCurrency:'USD/BTC';
	sourceAmount:number|string;
	fee:number|string;
	feeCurrency:'USD';
	finalAmount:number|string;
	finalCurrency:'USD'|'BTC';
	observedAt:string;
	priceSource:string;
	simulated:true;
};
type ConversionResult=ConversionPreview&{
	order:{id:string;status:string;quantity:number|string;filledQuantity:number|string;averageFillPrice:number|string|null;reviewRequired?:boolean};
	executionProvider:'AUREVIA_INTERNAL_SIMULATION';
};

const usdFormat=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2});
export default function BitcoinConversionExperience(){
	const [accountMode,setAccountMode]=useState<WalletSnapshot['accountMode']|null>(null);
	const [price,setPrice]=useState<number|null>(null);
	const [direction,setDirection]=useState<'BUY'|'SELL'>('BUY');
	const [amount,setAmount]=useState('');
	const [loading,setLoading]=useState(true);
	const [submitting,setSubmitting]=useState(false);
	const [previewing,setPreviewing]=useState(false);
	const [preview,setPreview]=useState<ConversionPreview|null>(null);
	const [confirmed,setConfirmed]=useState(false);
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
	const amountFormatValid=direction==='BUY'?/^\d+(?:\.\d{1,2})?$/.test(amount):/^\d+(?:\.\d{1,10})?$/.test(amount);
	const invalidAmount=!Number.isFinite(amountValue)||amountValue<=0||!amountFormatValid;
	const canPreview=accountMode==='REAL'&&price!==null&&!loading&&!submitting&&!previewing&&!invalidAmount;
	const canSubmit=canPreview&&!!preview&&confirmed;

	async function createPreview(){
		if(!canPreview)return;
		setPreviewing(true);setError('');setPreview(null);setConfirmed(false);setResult(null);
		try{
			const query=new URLSearchParams({direction,amount});
			const response=await fetch(`/api/wallet/convert-bitcoin?${query}`,{cache:'no-store'});
			const payload=await response.json();
			if(!response.ok)throw new Error(payload.error||'Unable to preview this conversion.');
			setPreview(payload as ConversionPreview);
		}catch(exception){
			setError(exception instanceof Error?exception.message:'Unable to preview this conversion.');
		}finally{setPreviewing(false);}
	}

	async function submit(event:FormEvent<HTMLFormElement>){
		event.preventDefault();
		if(!canSubmit||!preview)return;
		setSubmitting(true);setError('');setResult(null);
		try{
			const response=await fetch('/api/wallet/convert-bitcoin',{
				method:'POST',
				headers:{'content-type':'application/json','Idempotency-Key':window.crypto.randomUUID()},
				body:JSON.stringify({direction,amount,confirmed:true,referencePrice:String(preview.rate),observedAt:preview.observedAt}),
			});
			const payload=await response.json();
			if(!response.ok)throw new Error(payload.error||'Unable to submit the internal simulated Bitcoin order.');
			setResult(payload as ConversionResult);
			await load();
		}catch(exception){
			setError(exception instanceof Error?exception.message:'Unable to submit the internal simulated Bitcoin order.');
		}finally{setSubmitting(false);}
	}

	const orderStatus=useMemo(()=>result?.order.reviewRequired?'Requires review':result?.order.status.replaceAll('_',' ').toLowerCase()||'', [result]);

	return <><Nav/><main className="account-page">
		<header className="account-heading"><div><span className="account-kicker">ACCOUNT TOOLS</span><h1>Bitcoin conversion</h1><p>Buy or sell BTC/USD using funds and assets held in your REAL Aurevia Wallet.</p></div><span className="status-pill mode-real">INTERNAL SIMULATION</span></header>
		<section className="account-panel card p-5">
			<h2>REAL simulated Bitcoin order</h2>
			<p className="account-panel-subtitle">Orders are simulated by Aurevia and funded only by the matching currency or asset in your Aurevia Wallet. No external exchange order, bank transfer, or blockchain transaction is placed.</p>
			{loading?<p className="mt-4 flex items-center gap-2" role="status"><LoaderCircle size={16} className="animate-spin"/>Loading account and Bitcoin price</p>:accountMode===null?<p className="mt-4 text-red-400" role="alert">{error||'Unable to load your account mode.'}</p>:accountMode!=='REAL'?<div className="mt-4"><p role="status">Switch to REAL mode to submit an internal simulated wallet conversion. DEMO currency conversion is not supported.</p><Link className="btn bg-white/5 mt-3" href="/wallet"><ArrowLeftRight size={15}/>Open wallet settings</Link></div>:<form className="mt-5 grid gap-4" onSubmit={submit}>
				<div className="flex flex-wrap items-center justify-between gap-3"><div className="flex gap-2" role="group" aria-label="Conversion direction"><button type="button" className={`btn ${direction==='BUY'?'bg-gold text-black':'bg-white/5'}`} aria-pressed={direction==='BUY'} onClick={()=>{setDirection('BUY');setAmount('');setPreview(null);setConfirmed(false);setResult(null)}}><ArrowUpRight size={15}/>Buy BTC</button><button type="button" className={`btn ${direction==='SELL'?'bg-gold text-black':'bg-white/5'}`} aria-pressed={direction==='SELL'} onClick={()=>{setDirection('SELL');setAmount('');setPreview(null);setConfirmed(false);setResult(null)}}><ArrowDownRight size={15}/>Sell BTC</button></div><span className="text-sm">Simulated BTC/USD: <b>{price===null?'Unavailable':usdFormat.format(price)}</b></span></div>
				<label className="account-label">{direction==='BUY'?'Spend (USD)':'Sell (BTC)'}<input className="input mt-2" type="text" value={amount} onChange={event=>{setAmount(event.target.value);setPreview(null);setConfirmed(false);setResult(null)}} inputMode="decimal" required/></label>
				{amount&&!amountFormatValid&&<p className="text-sm text-red-400" role="status">{direction==='BUY'?'Enter USD to the nearest cent.':'Enter a BTC amount with up to 10 decimal places.'}</p>}
				{preview&&<div className="rounded border border-white/10 p-3 text-sm" role="status"><b>Review conversion before confirming</b><dl className="mt-2 grid gap-1"><div>Source: {preview.sourceAmount} {preview.sourceAsset}</div><div>Destination: {preview.destinationAsset}</div><div>Rate: {preview.rate} {preview.rateCurrency}</div><div>Fee: {preview.fee} {preview.feeCurrency}</div><div>Estimated final amount: {preview.finalAmount} {preview.finalCurrency}</div><div>Quote time: {new Date(preview.observedAt).toLocaleString()}</div></dl><p className="mt-2 muted">This is an Aurevia internal simulated price, not an external exchange rate. The quote must remain unchanged when you confirm.</p><label className="mt-3 flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/><span>I confirm the displayed simulated rate, fee, and estimated amount.</span></label></div>}
				{error&&<p className="text-sm text-red-400" role="alert">{error}</p>}
				{result&&<div className="rounded border border-white/10 p-3 text-sm" role="status"><b>Internal simulated order {orderStatus}.</b><p className="mt-1">Order ID: {result.order.id}. Final amount: {result.finalAmount} {result.finalCurrency}. Check <Link className="text-link" href="/orders">orders</Link> for its status.</p></div>}
				<div className="flex flex-wrap items-center gap-3"><button className="btn bg-white/5" type="button" onClick={()=>void createPreview()} disabled={!canPreview}>{previewing?<><LoaderCircle size={15} className="animate-spin"/>Getting quote…</>:<>Preview conversion</>}</button><button className="btn bg-gold text-black" type="submit" disabled={!canSubmit}>{submitting?<><LoaderCircle size={15} className="animate-spin"/>Submitting…</>:`Confirm ${direction==='BUY'?'buy':'sell'} in Aurevia`}</button><button className="btn bg-white/5" type="button" onClick={()=>void load()} disabled={loading||submitting}><RefreshCw size={15}/>Refresh</button><Link className="btn bg-white/5" href="/wallet"><ArrowLeftRight size={15}/>Back to wallet</Link></div>
			</form>}
		</section>
	</main></>;
}
