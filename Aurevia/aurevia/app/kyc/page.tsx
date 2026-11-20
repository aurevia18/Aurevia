'use client';

import {useCallback,useEffect,useState} from 'react';
import {useSession} from 'next-auth/react';
import {ShieldCheck} from 'lucide-react';
import Link from 'next/link';
import Nav from '@/components/Nav';
import KycVerificationCenter from '@/components/KycVerificationCenter';
import DiditKycPanel from '@/components/DiditKycPanel';

type KycDocument={id:string;kind:string;filename:string;status:string;uploadedAt:string;reviewedAt:string|null;reviewNote:string|null};
type PageState={kycStatus:string;phone:string;phoneVerified:boolean;address:string;currentTier:number;documents:KycDocument[]};

export default function Kyc(){
	const {data:session,status:sessionStatus}=useSession();
	const [page,setPage]=useState<PageState>({kycStatus:'PENDING',phone:'',phoneVerified:false,address:'',currentTier:1,documents:[]});
	const [loading,setLoading]=useState(true);
	const [uploadingProof,setUploadingProof]=useState(false);
	const [proofFile,setProofFile]=useState<File|null>(null);
	const [message,setMessage]=useState('');
	const [error,setError]=useState('');

	const load=useCallback(async()=>{
		if(sessionStatus==='loading')return;
		if(sessionStatus!=='authenticated'){setLoading(false);return}
		if(session?.user?.accountMode!=='REAL'){setLoading(false);setError('');return}
		setLoading(true);
		try{
			const [kycResponse,profileResponse,tierResponse,documentsResponse]=await Promise.all([
				fetch('/api/kyc',{cache:'no-store'}),
				fetch('/api/profile',{cache:'no-store'}),
				fetch('/api/tier-requests',{cache:'no-store'}),
				fetch('/api/kyc/documents',{cache:'no-store'}),
			]);
			const [kyc,profile,tier,documents]=await Promise.all([kycResponse.json(),profileResponse.json(),tierResponse.json(),documentsResponse.json()]);
			if(!kycResponse.ok||!profileResponse.ok||!tierResponse.ok||!documentsResponse.ok)throw new Error(kyc.error||profile.error||tier.error||documents.error||'Unable to load verification status.');
			setPage({
				kycStatus:profile.kycStatus||'PENDING',
				phone:profile.phone||'',
				phoneVerified:Boolean(profile.phoneVerified),
				address:profile.address||'',
				currentTier:typeof tier.currentTier==='number'?tier.currentTier:1,
				documents,
			});
			setError('');
		}catch(exception){setError(exception instanceof Error?exception.message:'Unable to load verification status.')}
		finally{setLoading(false)}
	},[session?.user?.accountMode,sessionStatus]);

	useEffect(()=>{void load()},[load]);
	const refreshTier=useCallback(()=>void load(),[load]);

	async function uploadProofOfAddress(){
		if(!proofFile||uploadingProof)return;
		setUploadingProof(true);setError('');setMessage('');
		try{
			const form=new FormData();
			form.append('file',proofFile);
			form.append('kind','PROOF_OF_ADDRESS');
			const response=await fetch('/api/kyc/documents',{method:'POST',body:form});
			const result=await response.json();
			if(!response.ok)throw new Error(result.error||'Unable to upload proof of address.');
			setProofFile(null);
			setMessage('Your proof of address was submitted for administrator review.');
			await load();
		}catch(exception){setError(exception instanceof Error?exception.message:'Unable to upload proof of address.')}
		finally{setUploadingProof(false)}
	}

	const isVerified=page.kycStatus==='APPROVED';
	const statusLabel=page.kycStatus.replaceAll('_',' ');
	const isRealAccount=session?.user?.accountMode==='REAL';
	const proofDocuments=page.documents.filter(document=>document.kind==='PROOF_OF_ADDRESS');
	const proofAlreadySubmitted=proofDocuments.some(document=>!['REJECTED','RESUBMISSION_REQUIRED'].includes(document.status));
	const canUploadProof=page.currentTier>=2&&page.kycStatus==='APPROVED'&&Boolean(page.address.trim())&&!proofAlreadySubmitted;

	return <><Nav/><main className="account-page">
	<header className="account-heading"><div><span className="account-kicker">Account verification</span><h1>Identity verification</h1><p>Submit identity details and evidence through Aurevia Verify for administrator review.</p></div>{isVerified?<span className="verified-badge"><ShieldCheck size={14} aria-hidden="true"/> Verified</span>:<span className="status-pill">{loading?'Loading status':statusLabel}</span>}</header>
		{sessionStatus==='authenticated'&&!isRealAccount?<section className="account-panel card p-5" role="status"><h2 className="font-semibold">REAL mode required</h2><p className="mt-2 text-sm leading-6 muted">Identity verification is available only in REAL mode. Switch account mode from the navigation to continue.</p></section>:<>
			{error&&<div className="account-callout mb-4" role="alert"><span>{error}</span><button type="button" className="text-link" disabled={loading||uploadingProof} onClick={()=>void load()}>Retry</button></div>}
			{message&&<p className="mb-4 text-sm text-profit" role="status">{message}</p>}
			<DiditKycPanel/>
			<KycVerificationCenter currentTier={page.currentTier} onUpdated={refreshTier}/>
			<section className="account-panel card mt-4 p-5">
				<h2 className="text-lg font-semibold">Verification tiers</h2>
				<div className="mt-3 overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><thead><tr className="border-b border-white/10"><th className="py-2 pr-4">Tier</th><th className="py-2 pr-4">Verification</th><th className="py-2">Limits / benefits</th></tr></thead><tbody>
					<tr className="border-b border-white/10"><th className="py-3 pr-4">Tier 1</th><td className="py-3 pr-4">No identity verification</td><td className="py-3">Basic access; lower configured withdrawal limits</td></tr>
					<tr className="border-b border-white/10"><th className="py-3 pr-4">Tier 2</th><td className="py-3 pr-4">Completed profile</td><td className="py-3">Medium configured withdrawal limits</td></tr>
					<tr><th className="py-3 pr-4">Tier 3</th><td className="py-3 pr-4">Administrator-approved identity verification, residential address and approved proof of address</td><td className="py-3">Highest configured limits and full account access, subject to review</td></tr>
				</tbody></table></div>
				<p className="mt-3 text-xs leading-5 muted">Trading and deposits are available before verification. Withdrawals require approved identity verification.</p>
			</section>
			{page.phone&&<p className="mt-3 text-xs muted">Registered phone number: {page.phone} · {page.phoneVerified?'Verified':'Not verified'}. Phone verification is optional and is not required to complete registration, submit KYC, or advance to the next account tier.</p>}
			{page.currentTier>=2&&page.kycStatus==='APPROVED'&&<section className="account-panel card mt-4 p-5">
				<h2 className="text-lg font-semibold">Tier 3 proof of address</h2>
				<p className="mt-2 text-sm leading-6 muted">Aurevia Verify identity approval is only one part of Tier 3 eligibility. Tier 3 also requires a residential address, proof of address, and administrator review.</p>
				{!page.address.trim()&&<p className="mt-3 text-sm muted">Add your residential address in <Link className="text-link" href="/settings#profile">Profile settings</Link> before uploading evidence.</p>}
				{proofDocuments.map(document=><div className="mt-3 rounded-lg border border-white/10 p-3 text-sm" key={document.id}><p>{document.filename} · {document.status.replaceAll('_',' ')}</p>{document.reviewNote&&<p className="mt-1 muted">{document.reviewNote}</p>}</div>)}
				{canUploadProof&&<div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]"><label className="account-label">Proof-of-address file<input className="input" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" onChange={event=>setProofFile(event.target.files?.[0]||null)}/><small className="muted">PDF or image · maximum 8 MB</small></label><button className="btn bg-gold text-black self-end" type="button" disabled={!proofFile||uploadingProof} onClick={()=>void uploadProofOfAddress()}>{uploadingProof?'Uploading…':'Upload proof of address'}</button></div>}
			</section>}
		</>}
	</main></>;
}
