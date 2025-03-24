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

  // State for spectral graph
  const [spectralData, setSpectralData] = useState(null);
  const [clickPosition, setClickPosition] = useState(null);

  // state for cursor stuff
  const [cursorPosition, setCursorPosition] = useState(null);

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

    // Set click position for graph placement
    setClickPosition({
      clientX: event.clientX,
      clientY: event.clientY,
      x,
      y
    });

    // bounds check
    if (x < 0 || x >= metadata.samples || y < 0 || y >= metadata.lines) {
      console.log('Click outside image bounds');
      setSpectralData(null);
      return;
    }

    console.log(`Pixel clicked at: (${x}, ${y})`);
    console.log(`Current band mapping: R=${bandIndices.red}, G=${bandIndices.green}, B=${bandIndices.blue}`);

    // Only collect spectrum data if we have the full dataset
    if (!isPreview) {
      const pixelSpectrum = [];
      const wavelengths = [];

      // Extract wavelength information if available
      let wavelengthData = [];
      if (metadata.wavelength) {
        try {
          // Try to parse wavelength data from metadata
          wavelengthData = metadata.wavelength
            .replace(/[{}]/g, '')
            .split(',')
            .map(w => parseFloat(w.trim()));
        } catch (error) {
          console.error('Failed to parse wavelength data:', error);
        }
      }

      // Collect spectral data for all bands
      for (let band = 0; band < metadata.bands; band++) {
        if (data[band] && data[band][y] && data[band][y][x] !== undefined) {
          const value = data[band][y][x];

          // Use band number as x-axis if no wavelength data
          const wavelength = wavelengthData[band] || band + 1;

          pixelSpectrum.push({
            band: band + 1,
            wavelength,
            value
          });
        }
      }

      // Update spectral data state
      setSpectralData({
        spectrum: pixelSpectrum,
        position: { x, y }
      });

      console.log('Full spectrum data collected:', pixelSpectrum);
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

      setSpectralData({
        spectrum: [
          { band: 1, wavelength: 1, value: redValue },
          { band: 2, wavelength: 2, value: greenValue },
          { band: 3, wavelength: 3, value: blueValue }
        ],
        position: { x, y },
        isPreview: true
      });
    }
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

  // function to detect clicks outside of the spectral graph for dismissal
  useEffect(() => {
    // Only add listener if spectrum is showing
    if (!spectralData) return;

    const handleOutsideClick = (event) => {
      // Check if click is on the spectral graph element
      const isClickOnGraph = event.target.closest('.spectral-graph');
      const isClickOnCanvas = event.target.closest('canvas');

      // If click is not on graph and not on canvas, dismiss graph
      if (!isClickOnGraph && !isClickOnCanvas) {
        setSpectralData(null);
      }
    };

    document.addEventListener('click', handleOutsideClick);

    return () => {
      document.removeEventListener('click', handleOutsideClick);
    };
  }, [spectralData]);

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

  // Calculate position for spectral graph popup
  const calculatePopupPosition = () => {
    if (!clickPosition || !canvasRef.current) return {};

    let left = clickPosition.clientX + 20; // 20px offset from cursor
    let top = clickPosition.clientY - 20;

    const graphWidth = 320;  // Estimated graph width
    const graphHeight = 240; // Estimated graph height

    // Check right edge
    if (left + graphWidth > window.innerWidth) {
      left = clickPosition.clientX - graphWidth - 20;
    }

    // Check bottom edge
    if (top + graphHeight > window.innerHeight) {
      top = clickPosition.clientY - graphHeight - 20;
    }

    if (top < 10) top = 10;

    return {
      position: 'fixed',
      left: `${left}px`,
      top: `${top}px`,
      zIndex: 1000
    };
  };

  // Render spectrum graph
  const renderSpectralGraph = () => {
    if (!spectralData || !spectralData.spectrum || spectralData.spectrum.length === 0) {
      return null;
    }

    // Sort data by wavelength/band for proper display
    const sortedData = [...spectralData.spectrum].sort((a, b) => a.wavelength - b.wavelength);

    // Make MODULAR!
    const maxValue = 5000;
    const minValue = 0;

    // Chart dimensions
    const chartWidth = 300;
    const chartHeight = 200;
    const paddingX = 50;
    const paddingY = 30;
    const graphWidth = chartWidth - (paddingX * 2);
    const graphHeight = chartHeight - (paddingY * 2);

    // points for line
    const points = sortedData.map((point, index) => {
      const x = paddingX + (index / (sortedData.length - 1)) * graphWidth;
      const y = paddingY + graphHeight - ((point.value - minValue) / (maxValue - minValue) * graphHeight);
      return `${x},${y}`;
    }).join(' ');

    // x-axis tick values
    const xTickCount = Math.min(9, sortedData.length);
    const xTicks = [];

    for (let i = 0; i < xTickCount; i++) {
      const index = Math.floor(i * (sortedData.length - 1) / (xTickCount - 1));
      const point = sortedData[index];
      const x = paddingX + (index / (sortedData.length - 1)) * graphWidth;
      xTicks.push({
        x,
        value: Math.round(point.wavelength)
      });
    }

    // Create y-axis tick values
    const yTickCount = 5;
    const yTicks = [];

    for (let i = 0; i < yTickCount; i++) {
      const value = minValue + (i / (yTickCount - 1)) * (maxValue - minValue);
      const y = paddingY + graphHeight - (i / (yTickCount - 1)) * graphHeight;
      yTicks.push({
        y,
        value: Math.round(value)
      });
    }

    const popupStyle = calculatePopupPosition();

    const handleMouseMove = (e) => {
      const svgRect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - svgRect.left;

      // Only set position if within the graph area
      if (x >= paddingX && x <= paddingX + graphWidth) {
        setCursorPosition(x);
      }
    };

    const handleMouseLeave = () => {
      setCursorPosition(null);
    };

    return (
      <div
        className="spectral-graph fixed bg-white border border-gray-300 rounded-lg shadow-lg p-4"
        style={popupStyle}
      >
        <div className="flex justify-between items-center mb-2">
          <h3 className="text-sm font-semibold">
            Spectral Profile of Pixel ({spectralData.position.x}, {spectralData.position.y})
          </h3>
          <button
            className="text-gray-500 hover:text-gray-700"
            onClick={() => setSpectralData(null)}
          >
            ×
          </button>
        </div>

        {spectralData.isPreview && (
          <div className="mb-2 text-xs text-orange-500">
            Limited data in preview mode. Process full dataset for complete spectrum.
          </div>
        )}



        <svg
          width={chartWidth}
          height={chartHeight}
          className="bg-gray-50"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          {/* X axis line */}
          <line
            x1={paddingX}
            y1={paddingY + graphHeight}
            x2={paddingX + graphWidth}
            y2={paddingY + graphHeight}
            stroke="#333"
            strokeWidth="1"
          />

          {/* Y axis line */}
          <line
            x1={paddingX}
            y1={paddingY}
            x2={paddingX}
            y2={paddingY + graphHeight}
            stroke="#333"
            strokeWidth="1"
          />

          {/* X-axis grid lines & labels */}
          {xTicks.map((tick, i) => (
            <React.Fragment key={`x-tick-${i}`}>
              <line
                x1={tick.x}
                y1={paddingY + graphHeight}
                x2={tick.x}
                y2={paddingY + graphHeight + 5}
                stroke="#333"
                strokeWidth="1"
              />
              <text
                x={tick.x}
                y={paddingY + graphHeight + 15}
                fontSize="10"
                textAnchor="middle"
              >
                {tick.value}
              </text>
            </React.Fragment>
          ))}

          {/* Y-axis grid lines & labels */}
          {yTicks.map((tick, i) => (
            <React.Fragment key={`y-tick-${i}`}>
              <line
                x1={paddingX - 5}
                y1={tick.y}
                x2={paddingX}
                y2={tick.y}
                stroke="#333"
                strokeWidth="1"
              />
              <text
                x={paddingX - 8}
                y={tick.y + 3}
                fontSize="10"
                textAnchor="end"
              >
                {tick.value}
              </text>
            </React.Fragment>
          ))}

          {/* Data line */}
          <polyline
            points={points}
            fill="none"
            stroke="#0040a6"
            strokeWidth="2"
          />

          {/* vertical examine line */}
          {cursorPosition && (
            <line
              x1={cursorPosition}
              y1={paddingY}
              x2={cursorPosition}
              y2={paddingY + graphHeight}
              stroke="#FF0000"
              strokeWidth="1"
            />
          )}

          {/* Axis labels */}
          <text
            x={chartWidth / 2}
            y={chartHeight - 5}
            fontSize="10"
            textAnchor="middle"
          >
            Band
          </text>

          <text
            x={15}
            y={paddingY + (graphHeight / 2)}
            fontSize="10"
            textAnchor="middle"
            transform={`rotate(-90, 15, ${paddingY + (graphHeight / 2)})`}
          >
            Intensity
          </text>
        </svg>
      </div>
    );
  };

  return (
    <div className="relative">
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

      {/* Render spectral graph popup */}
      {spectralData && renderSpectralGraph()}
    </div>
  );
};

export default ImageRenderer;