import React, { useEffect, useRef, useState } from 'react';

const ImageRenderer = ({ data, metadata, isPreview }) => {
  const canvasRef = useRef(null);
  const [bandIndices, setBandIndices] = useState({
    red: 0,
    green: 0,
    blue: 0
  });

  // Temporary input state to handle form changes before submission
  const [inputBands, setInputBands] = useState({
    red: 0,
    green: 0,
    blue: 0
  });

  // Initialize default bands on first render with metadata
  useEffect(() => {
    if (metadata && metadata["default bands"]) {
      const defaultVals = metadata["default bands"].replace(/[{}]/g, '').split(',').map(Number);

      const newBands = {
        red: defaultVals[0],
        green: defaultVals[1],
        blue: defaultVals[2]
      };

      setBandIndices(newBands);
      setInputBands(newBands);
    }
  }, [metadata]);

  // Handle input changes
  const handleInputChange = (channel, value) => {
    setInputBands(prev => ({
      ...prev,
      [channel]: value
    }));
  };

  // Handle form submission (when user presses Enter)
  const handleSubmit = (e) => {
    e.preventDefault();

    // Create a new object for the updated bands
    const newBands = { ...inputBands };
    let isValid = true;

    // Validate all band numbers
    Object.keys(newBands).forEach(channel => {
      const bandNum = parseInt(newBands[channel], 10);

      if (isNaN(bandNum) || bandNum < 1 || bandNum > metadata.bands) {
        alert(`Please enter a valid band number between 1 and ${metadata.bands} for ${channel.toUpperCase()}`);
        // Reset to previous value
        newBands[channel] = bandIndices[channel];
        isValid = false;
      } else {
        // Keep the validated number
        newBands[channel] = bandNum;
      }
    });

    // Only update if all values are valid
    if (isValid) {
      console.log('Updating all bands to:', newBands);
      setBandIndices(newBands);
    }

    // Make sure input fields reflect the final values (whether changed or not)
    setInputBands(newBands);
  };

  // Handle pixel click event
  const handlePixelClick = (event) => {
    const canvas = canvasRef.current;
    if (!canvas || !data || !metadata) return;

    // bounding rectangle of the canvas
    const rect = canvas.getBoundingClientRect();

    // pixel coordinates
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = Math.floor((event.clientX - rect.left) * scaleX);
    const y = Math.floor((event.clientY - rect.top) * scaleY);

    // bounds check
    if (x < 0 || x >= metadata.samples || y < 0 || y >= metadata.lines) {
      console.log('Click outside image bounds');
      return;
    }

    console.log(`Pixel clicked at: (${x}, ${y})`);
    console.log(`Current band mapping: R=${bandIndices.red}, G=${bandIndices.green}, B=${bandIndices.blue}`);

    const pixelSpectrum = [];

    // Only collect spectrum data if we have the full dataset
    if (!isPreview) {
      console.log('Spectral values for all bands:');

      for (let band = 0; band < metadata.bands; band++) {
        if (data[band] && data[band][y] && data[band][y][x] !== undefined) {
          const value = data[band][y][x];
          pixelSpectrum.push(value);
          console.log(`band ${band + 1}: ${value}`);
        }
      }

      console.log('Full spectrum data:', pixelSpectrum);
    } else {
      // For preview, we only have RGB data
      const redValue = data[0][y][x];
      const greenValue = data[1][y][x];
      const blueValue = data[2][y][x];

      console.log('Only RGB values available:', {
        red: redValue,
        green: greenValue,
        blue: blueValue
      });
    }

    // Log some relevant metadata
    console.log('Metadata for spectral plotting:', {
      samples: metadata.samples,
      lines: metadata.lines,
      bands: metadata.bands,
      // Include any wavelength information if available in metadata
      wavelength: metadata.wavelength || 'Not available'
    });
  };

  // Main rendering effect - runs when bandIndices change
  useEffect(() => {
    if (data && metadata) {
      console.log(`Rendering ${isPreview ? 'preview' : 'full'} data with bands:`, bandIndices);

      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');

      const samples = parseInt(metadata.samples, 10);
      const lines = parseInt(metadata.lines, 10);

      // Early exit if invalid dimensions
      if (isNaN(samples) || isNaN(lines)) {
        console.error('Invalid samples or lines values');
        return;
      }

      // Set canvas dimensions
      canvas.width = samples;
      canvas.height = lines;

      // For preview, we always use the pre-processed RGB data
      if (isPreview) {
        renderPreviewData(ctx, data, samples, lines);
        return;
      }

      // For full data, we use the selected bands
      renderFullData(ctx, data, samples, lines, bandIndices);
    }
  }, [data, metadata, isPreview, bandIndices]);

  // Event listener for canvas click
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Click event listener
    canvas.addEventListener('click', handlePixelClick);

    // Clean up event listener on unmount
    return () => {
      canvas.removeEventListener('click', handlePixelClick);
    };
  }, [data, metadata, isPreview, bandIndices]); // Refresh when these dependencies change

  // Render preview data (pre-processed RGB)
  const renderPreviewData = (ctx, data, samples, lines) => {
    const imageData = ctx.createImageData(samples, lines);

    // Calculate statistics for preview bands
    const bandStats = {
      red: calculateBandStats(data[0], samples, lines),
      green: calculateBandStats(data[1], samples, lines),
      blue: calculateBandStats(data[2], samples, lines)
    };

    // Process each pixel
    for (let i = 0; i < samples * lines; i++) {
      const line = Math.floor(i / samples);
      const sample = i % samples;

      try {
        const redValue = data[0][line][sample];
        const greenValue = data[1][line][sample];
        const blueValue = data[2][line][sample];

        const normalizedRed = normalize(redValue, bandStats.red.min, bandStats.red.max);
        const normalizedGreen = normalize(greenValue, bandStats.green.min, bandStats.green.max);
        const normalizedBlue = normalize(blueValue, bandStats.blue.min, bandStats.blue.max);

        imageData.data[i * 4 + 0] = normalizedRed;
        imageData.data[i * 4 + 1] = normalizedGreen;
        imageData.data[i * 4 + 2] = normalizedBlue;
        imageData.data[i * 4 + 3] = 255;
      } catch (error) {
        console.error(`Error processing pixel at line ${line}, sample ${sample}:`, error);
        // Set to black if there's an error
        imageData.data[i * 4 + 0] = 0;
        imageData.data[i * 4 + 1] = 0;
        imageData.data[i * 4 + 2] = 0;
        imageData.data[i * 4 + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);
  };

  // Render full data with user-selected bands
  const renderFullData = (ctx, data, samples, lines, bandIndices) => {
    const imageData = ctx.createImageData(samples, lines);

    // Convert from 1-based band numbers (user facing) to 0-based indices
    const redIndex = bandIndices.red - 1;
    const greenIndex = bandIndices.green - 1;
    const blueIndex = bandIndices.blue - 1;

    // Calculate statistics for selected bands
    const bandStats = {
      red: calculateBandStats(data[redIndex], samples, lines),
      green: calculateBandStats(data[greenIndex], samples, lines),
      blue: calculateBandStats(data[blueIndex], samples, lines)
    };

    console.log('Band statistics for rendering:', bandStats);

    // Process each pixel
    for (let i = 0; i < samples * lines; i++) {
      const line = Math.floor(i / samples);
      const sample = i % samples;

      try {
        const redValue = data[redIndex][line][sample];
        const greenValue = data[greenIndex][line][sample];
        const blueValue = data[blueIndex][line][sample];

        const normalizedRed = normalize(redValue, bandStats.red.min, bandStats.red.max);
        const normalizedGreen = normalize(greenValue, bandStats.green.min, bandStats.green.max);
        const normalizedBlue = normalize(blueValue, bandStats.blue.min, bandStats.blue.max);

        imageData.data[i * 4 + 0] = normalizedRed;
        imageData.data[i * 4 + 1] = normalizedGreen;
        imageData.data[i * 4 + 2] = normalizedBlue;
        imageData.data[i * 4 + 3] = 255;
      } catch (error) {
        console.error(`Error processing pixel at line ${line}, sample ${sample}:`, error);
        // Set to black if there's an error
        imageData.data[i * 4 + 0] = 0;
        imageData.data[i * 4 + 1] = 0;
        imageData.data[i * 4 + 2] = 0;
        imageData.data[i * 4 + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);
  };

  // Calculate statistics for a band
  const calculateBandStats = (bandData, samples, lines) => {
    if (!bandData) {
      console.error('Band data not found');
      return { min: 0, max: 65535 };
    }

    const values = [];
    for (let line = 0; line < lines; line++) {
      for (let sample = 0; sample < samples; sample++) {
        if (bandData[line] && bandData[line][sample] !== undefined) {
          values.push(bandData[line][sample]);
        }
      }
    }

    if (values.length === 0) {
      console.error('No valid values found in band');
      return { min: 0, max: 65535 };
    }

    values.sort((a, b) => a - b);
    const lowerIndex = Math.floor(values.length * 0.01);
    const upperIndex = Math.floor(values.length * 0.99);

    return {
      min: values[lowerIndex],
      max: values[upperIndex]
    };
  };

  // Normalize function with gamma correction
  const normalize = (value, min, max) => {
    let normalized = (value - min) / (max - min);
    normalized = Math.max(0, Math.min(1, normalized));
    normalized = Math.pow(normalized, 0.9);
    return Math.floor(normalized * 255);
  };

  return (
    <div>
      <canvas ref={canvasRef} style={{ cursor: 'crosshair' }} />

      {!isPreview && (
        <div className="mt-4">
          <form onSubmit={handleSubmit} className="flex gap-4">
            <div className="flex items-center">
              <label className="mr-2 font-medium text-red-600">R:</label>
              <input
                type="number"
                className="border rounded px-2 py-1 w-16"
                value={inputBands.red}
                onChange={(e) => handleInputChange('red', e.target.value)}
                min="1"
                max={metadata?.bands || 100}
              />
            </div>
            <div className="flex items-center">
              <label className="mr-2 font-medium text-green-600">G:</label>
              <input
                type="number"
                className="border rounded px-2 py-1 w-16"
                value={inputBands.green}
                onChange={(e) => handleInputChange('green', e.target.value)}
                min="1"
                max={metadata?.bands || 100}
              />
            </div>
            <div className="flex items-center">
              <label className="mr-2 font-medium text-blue-600">B:</label>
              <input
                type="number"
                className="border rounded px-2 py-1 w-16"
                value={inputBands.blue}
                onChange={(e) => handleInputChange('blue', e.target.value)}
                min="1"
                max={metadata?.bands || 100}
              />
            </div>
            <button
              type="submit"
              className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded"
            >
              Update
            </button>
          </form>
        </div>
      )}
    </div>
  );
};

export default ImageRenderer;