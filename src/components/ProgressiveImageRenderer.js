import React, { useEffect, useRef, useState, useCallback } from 'react';

const ProgressiveImageRenderer = ({ bandData, metadata, loadedBands, dataFile, onComplete }) => {
  const canvasRef = useRef(null);
  const [renderProgress, setRenderProgress] = useState(0);
  const [isRendering, setIsRendering] = useState(false);

  const renderPartialImage = useCallback((ctx, partialData, metadata, linesRendered) => {
    const { samples } = metadata;
    
    // Calculate normalization (simplified for demo)
    const stats = calculateBandStats(partialData, linesRendered);
    
    // Create image data for rendered lines only
    const imageData = ctx.createImageData(samples, linesRendered);
    const data = imageData.data;
    
    let dataIndex = 0;
    for (let line = 0; line < linesRendered; line++) {
      for (let sample = 0; sample < samples; sample++) {
        const redValue = partialData[0]?.[line]?.[sample] || 0;
        const greenValue = partialData[1]?.[line]?.[sample] || 0;
        const blueValue = partialData[2]?.[line]?.[sample] || 0;
        
        // Simple normalization
        data[dataIndex++] = normalize(redValue, stats.red) * 255;
        data[dataIndex++] = normalize(greenValue, stats.green) * 255;
        data[dataIndex++] = normalize(blueValue, stats.blue) * 255;
        data[dataIndex++] = 255; // Alpha
      }
    }
    
    ctx.putImageData(imageData, 0, 0);
  }, []);

  const calculateBandStats = useCallback((bandData, linesRendered) => {
    const stats = { red: {min: Infinity, max: -Infinity}, 
                   green: {min: Infinity, max: -Infinity}, 
                   blue: {min: Infinity, max: -Infinity} };
    
    ['red', 'green', 'blue'].forEach((color, idx) => {
      if (!bandData[idx]) return;
      
      for (let line = 0; line < linesRendered; line++) {
        const lineData = bandData[idx][line];
        if (!lineData) continue;
        
        for (let sample = 0; sample < lineData.length; sample += 5) { // Sample every 5th
          const value = lineData[sample];
          if (value > 0 && value < 55000) {
            stats[color].min = Math.min(stats[color].min, value);
            stats[color].max = Math.max(stats[color].max, value);
          }
        }
      }
    });
    
    return stats;
  }, []);

  const normalize = useCallback((value, stats) => {
    if (stats.max <= stats.min) return 0;
    return Math.max(0, Math.min(1, (value - stats.min) / (stats.max - stats.min)));
  }, []);

  const renderProgressively = useCallback(async () => {
    if (!dataFile || !metadata || !canvasRef.current) return;
    
    setIsRendering(true);
    setRenderProgress(0);

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const { samples, lines } = metadata;
    
    canvas.width = samples;
    canvas.height = lines;

    // Load bands progressively
    const progressiveBandData = await parseSpecificBandsProgressive(
      dataFile, 
      metadata, 
      loadedBands,
      (progress, partialData, linesRendered) => {
        // Update progress
        setRenderProgress(progress);
        
        // Render partial image
        renderPartialImage(ctx, partialData, metadata, linesRendered);
      }
    );

    setIsRendering(false);
    setRenderProgress(1);
    
    if (onComplete) {
      onComplete(progressiveBandData);
    }
  }, [dataFile, metadata, loadedBands, onComplete, renderPartialImage]);

  useEffect(() => {
    if (dataFile && metadata) {
      renderProgressively();
    }
  }, [dataFile, metadata, renderProgressively]);

  return (
    <div className="relative">
      {isRendering && (
        <div className="absolute top-0 left-0 right-0 bg-blue-500 text-white p-2 z-10">
          <div className="flex items-center gap-2">
            <div className="text-sm">Loading BIP data...</div>
            <div className="flex-1 bg-blue-300 rounded-full h-2">
              <div 
                className="bg-white h-2 rounded-full transition-all duration-300"
                style={{ width: `${renderProgress * 100}%` }}
              />
            </div>
            <div className="text-sm">{Math.round(renderProgress * 100)}%</div>
          </div>
        </div>
      )}
      
      <canvas 
        ref={canvasRef} 
        className={`transition-opacity duration-300 ${isRendering ? 'opacity-70' : 'opacity-100'}`}
        style={{ cursor: 'crosshair' }} 
      />
    </div>
  );
};

// Mock function for progressive parsing (you'll need to implement this)
async function parseSpecificBandsProgressive(dataFile, metadata, loadedBands, progressCallback) {
  // This is a placeholder - you'd need to implement actual progressive parsing
  // For now, just simulate progress
  const totalLines = metadata.lines;
  const bandData = [[], [], []]; // Three bands
  
  for (let line = 0; line < totalLines; line += 10) {
    const linesRendered = Math.min(line + 10, totalLines);
    const progress = linesRendered / totalLines;
    
    // Simulate loading data for these lines
    for (let i = 0; i < 3; i++) {
      for (let l = line; l < linesRendered; l++) {
        if (!bandData[i][l]) {
          bandData[i][l] = new Uint16Array(metadata.samples).fill(Math.random() * 1000);
        }
      }
    }
    
    progressCallback(progress, bandData, linesRendered);
    
    // Yield to browser
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  
  return bandData;
}

export default ProgressiveImageRenderer;