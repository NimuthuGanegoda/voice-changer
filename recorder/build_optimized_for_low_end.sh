#!/bin/bash

# Script to build the optimized version for low-end devices

echo "Building optimized version for low-end devices..."

# Navigate to the recorder directory
cd "$(dirname "$0")"

# Clean previous build
echo "Cleaning previous build..."
npm run clean

# Build the optimized version
echo "Building optimized entry version..."
npm run build:optimized-entry

# Analyze the bundle size
echo "Analyzing bundle size..."
npm run analyze-bundle

echo "Build completed! The optimized version is in the ../docs folder."
echo ""
echo "To serve the application:"
echo "1. Make sure you have a web server running"
echo "2. Serve the contents of the ../docs folder"
echo ""
echo "For local testing, you can use:"  
echo "npx http-server ../docs"