const path = require("path");
const { merge } = require("webpack-merge");
const common = require("./webpack.common.js");
const backend = process.env.VC_BACKEND_URL || "http://127.0.0.1:18888";
const apiPaths = ["/info", "/performance", "/upload_file", "/concat_uploaded_file", "/update_settings", "/load_model", "/onnx", "/merge_model", "/update_model_default", "/update_model_info", "/upload_model_assets", "/test", "/play_sound", "/soundboard", "/tts", "/device_setup", "/socket.io", "/model_dir", "/tmp", "/upload_dir", "/api"];

module.exports = merge(common, {
    mode: "development",
    devtool: "inline-source-map",
    devServer: {
        static: { directory: path.join(__dirname, "public") },
        client: { overlay: { errors: true, warnings: false } },
        host: "0.0.0.0",
        port: Number(process.env.PORT || 8080),
        allowedHosts: "all", // development only; the sandbox uses a proxy hostname
        server: process.env.VC_DEV_HTTPS === "false" ? "http" : "https",
        proxy: apiPaths.map(context => ({
            context,
            target: backend,
            changeOrigin: true,
            ws: context === "/socket.io",
            secure: false, // local development server may use a self-signed cert
            headers: process.env.VCCLIENT_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.VCCLIENT_ACCESS_TOKEN}` } : {},
            on: { proxyReq(proxyReq) { proxyReq.setHeader("Origin", backend); } },
        })),
    },
});
