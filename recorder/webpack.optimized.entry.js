/* eslint @typescript-eslint/no-var-requires: "off" */
const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const webpack = require("webpack");
const CopyPlugin = require("copy-webpack-plugin");
const TerserPlugin = require('terser-webpack-plugin');

module.exports = {
    entry: path.resolve(__dirname, "src/index.optimized.tsx"),
    output: {
        path: path.resolve(__dirname, "..", "docs"),
        filename: "index.optimized.js",
        assetModuleFilename: "assets/[name][ext][hash]",
    },
    resolve: {
        modules: [path.resolve(__dirname, "node_modules")],
        extensions: [".ts", ".tsx", ".js"],
        fallback: {
            buffer: require.resolve("buffer/"),
        },
    },
    module: {
        rules: [
            {
                test: [/\.ts$/, /\.tsx$/],
                use: [
                    {
                        loader: "ts-loader",
                        options: {
                            // transpileOnly: true,
                            configFile: "tsconfig.json",
                        },
                    },
                ],
            },
            {
                test: /\.css$/,
                use: ["style-loader", { loader: "css-loader", options: { importLoaders: 1 } }, "postcss-loader"],
            },
            {
                test: /\.html$/,
                loader: "html-loader",
            },
        ],
    },
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
    plugins: [
        new HtmlWebpackPlugin({
            template: path.resolve(__dirname, "public/index.html"),
            filename: "./index.html",
        }),
        new webpack.ProvidePlugin({
            Buffer: ["buffer", "Buffer"],
            process: "process/browser",
        }),
        new CopyPlugin({
            patterns: [
                {
                    from: "public/",
                    globOptions: {
                        ignore: ["**/index.html*"],
                    },
                },
            ],
        }),
    ],
};