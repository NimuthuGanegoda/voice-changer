#!/usr/bin/env node

/**
 * Simple bundle analyzer script to check the size of the optimized build
 */

const fs = require('fs');
const path = require('path');

function analyzeBundle(dirPath) {
    console.log('Analyzing bundle in:', dirPath);
    
    const files = fs.readdirSync(dirPath);
    let totalSize = 0;
    
    console.log('\nBundle Analysis:');
    console.log('================');
    
    files.forEach(file => {
        const filePath = path.join(dirPath, file);
        const stat = fs.statSync(filePath);
        
        if (stat.isDirectory()) {
            console.log(`${file}/ (directory)`);
            analyzeBundle(filePath);  // Recursive analysis
        } else {
            const sizeInKB = Math.round(stat.size / 1024);
            totalSize += stat.size;
            
            // Highlight large files (>100KB)
            const warning = sizeInKB > 100 ? ' ⚠️ LARGE FILE' : '';
            console.log(`  ${file}: ${sizeInKB} KB${warning}`);
        }
    });
    
    console.log(`\nTotal bundle size: ${Math.round(totalSize / 1024)} KB (${totalSize} bytes)`);
    
    // Check if bundle size is reasonable for low-end devices
    if (totalSize > 1024 * 1000) { // More than 1MB
        console.log('⚠️  Warning: Bundle size is larger than recommended for low-end devices (<1MB)');
    } else if (totalSize > 512 * 1000) { // More than 512KB
        console.log('⚠️  Warning: Bundle size is approaching limit for low-end devices (<512KB optimal)');
    } else {
        console.log('✅ Bundle size is optimized for low-end devices');
    }
}

// Check if docs directory exists
const docsDir = path.join(__dirname, '..', 'docs');

if (fs.existsSync(docsDir)) {
    analyzeBundle(docsDir);
} else {
    console.log('Docs directory does not exist. Run a build first:');
    console.log('  npm run build:optimized-entry');
    console.log('or');
    console.log('  npm run build:optimized');
}