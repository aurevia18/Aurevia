/** @type {import('next').NextConfig} */
const supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL;
const remotePatterns=[];
if(supabaseUrl){
	const storageUrl=new URL(supabaseUrl);
	remotePatterns.push({protocol:storageUrl.protocol.slice(0,-1),hostname:storageUrl.hostname,port:storageUrl.port,pathname:'/storage/v1/object/sign/client-stories/**'});
}
const nextConfig={
	reactStrictMode:true,
	turbopack:{root:process.cwd()},
	distDir:process.env.AUREVIA_NEXT_DIST_DIR||'.next',
	experimental:{agentUpgrade:'security'},
	...(remotePatterns.length?{images:{remotePatterns}}:{}),
	async headers(){
		return [{
			source:'/reset-password',
			headers:[{key:'Referrer-Policy',value:'no-referrer'}],
		},{
			source:'/manifest.webmanifest',
			headers:[{key:'Content-Type',value:'application/manifest+json'},{key:'Cache-Control',value:'public, max-age=0, must-revalidate'}],
		},{
			source:'/sw.js',
			headers:[{key:'Cache-Control',value:'no-cache, no-store, must-revalidate'}],
		},{
			source:'/icons/:path*',
			headers:[{key:'Cache-Control',value:'public, max-age=31536000, immutable'}],
		}];
	},
};
export default nextConfig;
