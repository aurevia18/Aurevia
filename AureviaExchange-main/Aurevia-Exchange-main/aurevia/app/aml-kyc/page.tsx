import InfoPage from '@/components/InfoPage';

export default function AmlKycPolicy(){
	return <InfoPage eyebrow="Account verification · Version 2026-11-15-v1" title="Identity and account review" lead="How Aurevia currently handles identity-verification workflows." updated="November 15, 2026" importantNote="This is a product-process summary, not legal or compliance advice. It does not claim that Aurevia performs automated AML, sanctions, or regulatory screening." sections={[
		{title:'Identity verification',content:<p>REAL-mode users may submit identity information and private document images through Aurevia Verify. File integrity checks do not establish identity; an authorized Aurevia administrator must review the evidence and record a decision. A submission or REAL-mode selection does not itself approve an account.</p>},
		{title:'Account review',content:<p>Identity documents and proof-of-address submissions are handled through the configured private-storage and administrator-review workflows. Results and administrator actions are recorded in the account history. Do not submit documents in an evaluation environment.</p>},
		{title:'Service limitations',content:<p>Automated OCR, document authenticity, face matching, duplicate identity matching, and liveness checks are not available. Manual review does not represent AML/sanctions screening or discharge jurisdiction-specific obligations.</p>},
	]}/>;
}
