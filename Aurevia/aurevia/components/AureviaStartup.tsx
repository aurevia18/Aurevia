'use client';

import Image from 'next/image';
import {useEffect,useRef,useState} from 'react';
import AureviaLoading from '@/components/AureviaLoading';

type Orientation='landscape'|'portrait';

const introVideos={
	landscape:'/videos/aurevia-intro-desktop.mp4',
	portrait:'/videos/aurevia-intro-mobile.mp4',
};

export default function AureviaStartup({isVisible,isExiting,onSkip,onReplay}:{isVisible:boolean;isExiting:boolean;onSkip:()=>void;onReplay:()=>void}){
	const skipButton=useRef<HTMLButtonElement>(null);
	const replayButton=useRef<HTMLButtonElement>(null);
	const videoRef=useRef<HTMLVideoElement>(null);
	const wasVisible=useRef(false);
	const [orientation,setOrientation]=useState<Orientation|null>(null);
	const [sourceIndex,setSourceIndex]=useState(0);
	const [needsPlay,setNeedsPlay]=useState(false);
	const [videoUnavailable,setVideoUnavailable]=useState(false);

	useEffect(()=>{
		const portraitQuery=window.matchMedia('(orientation: portrait)');
		const updateOrientation=()=>setOrientation(portraitQuery.matches?'portrait':'landscape');
		updateOrientation();
		portraitQuery.addEventListener('change',updateOrientation);
		return()=>portraitQuery.removeEventListener('change',updateOrientation);
	},[]);

	useEffect(()=>{
		if(isVisible){
			wasVisible.current=true;
			skipButton.current?.focus({preventScroll:true});
		}else if(wasVisible.current){
			wasVisible.current=false;
			replayButton.current?.focus({preventScroll:true});
		}
	},[isVisible]);

	useEffect(()=>{
		if(!isVisible)return;
		setSourceIndex(0);
		setNeedsPlay(false);
		setVideoUnavailable(false);
	},[isVisible,orientation]);

	const preferredSource=orientation?introVideos[orientation]:null;
	const fallbackSource=orientation?introVideos[orientation==='portrait'?'landscape':'portrait']:null;
	const source=sourceIndex===0?preferredSource:fallbackSource;

	useEffect(()=>{
		if(!isVisible||!source)return;
		const video=videoRef.current;
		if(!video)return;
		video.muted=true;
		void video.play().then(()=>setNeedsPlay(false)).catch(()=>setNeedsPlay(true));
	},[isVisible,source]);

	if(!isVisible)return <button className="exchange-intro-replay" type="button" onClick={onReplay} ref={replayButton}>Replay intro</button>;

	return <div className={`exchange-intro${isExiting?' is-exiting':''}`} role="dialog" aria-modal="true" aria-label="Aurevia Exchange introduction">
		<div className="exchange-intro-glow" aria-hidden="true"/>
		<Image className="exchange-intro-poster" src="/aurevia-logo.png" alt="" aria-hidden="true" width={512} height={512} priority sizes="(max-width: 600px) 58vw, 320px"/>
		{source&&<video
			key={source}
			ref={videoRef}
			className="exchange-intro-video"
			src={source}
			autoPlay
			muted
			playsInline
			preload="metadata"
			poster="/aurevia-logo.png"
			onPlay={()=>setNeedsPlay(false)}
			onEnded={onSkip}
			onTimeUpdate={event=>{
				if(event.currentTarget.currentTime>=7){
					event.currentTarget.pause();
					onSkip();
				}
			}}
			onError={()=>{
				if(sourceIndex===0&&fallbackSource){
					setSourceIndex(1);
					setNeedsPlay(false);
					return;
				}
				setVideoUnavailable(true);
				setNeedsPlay(false);
			}}
		/>}
		<div className="exchange-intro-brand" aria-hidden="true"><span>AUREVIA</span><small>EXCHANGE</small></div>
		<button className="exchange-intro-skip" type="button" onClick={()=>{
			videoRef.current?.pause();
			onSkip();
		}} ref={skipButton}>Skip intro</button>
		{(needsPlay||videoUnavailable)&&<div className="exchange-intro-actions">
			<p role="status">{videoUnavailable?'The introduction video is unavailable.':'Start the introduction when you are ready.'}</p>
			<button type="button" onClick={()=>{
				if(videoUnavailable){
					onSkip();
					return;
				}
				const video=videoRef.current;
				if(!video)return;
				void video.play().then(()=>setNeedsPlay(false)).catch(()=>setNeedsPlay(true));
			}}>{videoUnavailable?'Continue to Aurevia':'Play intro'}</button>
		</div>}
	</div>;
}

export function AureviaStartupLoader({isExiting}:{isExiting:boolean}){
	return <AureviaLoading
		variant="screen"
		label="Loading Aurevia Exchange"
		detail="Restoring your workspace"
		className={`startup-screen${isExiting?' is-exiting':''}`}
	/>;
}
