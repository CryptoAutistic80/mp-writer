//@ts-check

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { composePlugins, withNx } = require('@nx/next');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('path');
// Load env from workspace root so we can keep a single unified .env
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

/**
 * @type {import('@nx/next/plugins/with-nx').WithNxOptions & import('next').NextConfig}
 **/
const nextConfig = {
	// Use this to set Nx-specific options
	// See: https://nx.dev/recipes/next/next-config-setup
	nx: {
		svgr: false,
	},
        env: {
                // Expose only public variables that the browser needs
                NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
                NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
        },
	webpack: (config) => {
		// Handle importing SVGs as React components using SVGR
		config.module.rules.push({
			test: /\.svg$/i,
			issuer: /\.(js|ts|jsx|tsx)$/,
			use: [
				{
					loader: require.resolve('@svgr/webpack'),
					options: {
						// Keep JSX output for React 17+
						jsxRuntime: 'automatic',
					},
				},
			],
		});
		return config;
	},
	async rewrites() {
		const origin = process.env.NEXT_BACKEND_ORIGIN || 'http://localhost:4000';
		return [
			{
				source: '/api/:path*',
				destination: `${origin}/api/:path*`,
			},
		];
	},
};

const plugins = [
	// Add more Next.js plugins to this list if needed.
	withNx,
];

module.exports = composePlugins(...plugins)(nextConfig);
