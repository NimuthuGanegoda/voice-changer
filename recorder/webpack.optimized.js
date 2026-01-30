const { merge } = require('webpack-merge');
const common = require('./webpack.common.js');
const path = require("path");
const TerserPlugin = require('terser-webpack-plugin');

module.exports = merge(common, {
    mode: 'production',
    optimization: {
        minimize: true,
        minimizer: [
            new TerserPlugin({
                terserOptions: {
                    compress: {
                        drop_console: true, // Remove console.logs
                        drop_debugger: true,
                        pure_funcs: ['console.log'], // Remove console.log statements
                    },
                    mangle: true,
                    format: {
                        comments: false, // Remove comments
                    },
                },
                extractComments: false,
            }),
        ],
        splitChunks: {
            chunks: 'all',
            cacheGroups: {
                vendor: {
                    test: /[\\/]node_modules[\\/]/,
                    name: 'vendors',
                    chunks: 'all',
                    priority: 10,
                    maxSize: 244000, // ~244KB chunk size
                },
                react: {
                    test: /[\\/]node_modules[\\/](react|react-dom)[\\/]/,
                    name: 'react',
                    chunks: 'all',
                    priority: 20,
                },
                fontawesome: {
                    test: /[\\/]node_modules[\\/](@fortawesome)[\\/]/,
                    name: 'fontawesome',
                    chunks: 'all',
                    priority: 15,
                }
            }
        }
    },
    performance: {
        maxAssetSize: 250000, // 250KB
        maxEntrypointSize: 250000, // 250KB
        hints: 'warning'
    },
    output: {
        ...common.output,
        filename: '[name].[contenthash].js',
        chunkFilename: '[name].[contenthash].chunk.js',
    },
    plugins: [
        ...common.plugins,
        // Add compression plugin for smaller bundles
        ...(common.plugins || [])
    ]
});