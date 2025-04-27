import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';

const ImageRenderer = ({ data, metadata, isPreview }) => {
  const canvasRef = useRef(null);
  const svgRef = useRef(null);
  const [bands, setBands] = useState({ red: 29, green: 19, blue: 9 }); // AVIRIS default

  const [spectralDataArray, setSpectralDataArray] = useState([]);
  const [showSpectralGraph, setShowSpectralGraph] = useState(false);

  const [hoveredPoint, setHoveredPoint] = useState(null);
  const [cursorPosition, setCursorPosition] = useState(null);
  const [globalStats, setGlobalStats] = useState({ percentile99: 5000 });

  // Image enhancement control settings
  const [normalizationSettings, setNormalizationSettings] = useState({
    lowerPercentile: 0.01, // Default 1st percentile
    upperPercentile: 0.99, // Default 99th percentile
    gamma: 0.65 // Default gamma value
  });

  // Initialize bands from metadata
  useEffect(() => {
    if (metadata && metadata["default bands"]) {
      const defaultVals = metadata["default bands"].replace(/[{}]/g, '').split(',').map(Number);
      setBands({
        red: defaultVals[0],
        green: defaultVals[1],
        blue: defaultVals[2]
      });
    }
  }, [metadata]);

  // global statistics for visualization
  useEffect(() => {
    if (!isPreview && data && metadata) {
      const calculateStats = () => {
        const allValues = [];
        const bands = data.length;
        const samples = metadata.samples;
        const lines = metadata.lines;
        const ignoreValue = parseFloat(metadata["data ignore value"] || 0.0);
        const samplingRate = 0.05;

        // Sample bands and pixels for performance
        for (let band = 0; band < bands; band += 20) {
          for (let line = 0; line < lines; line++) {
            if (Math.random() > samplingRate) continue;
            if (!data[band] || !data[band][line]) continue;

            for (let sample = 0; sample < samples; sample++) {
              if (Math.random() > samplingRate) continue;

              const value = data[band][line][sample];
              if (value !== undefined && value !== ignoreValue && value < 55536 && value >= 0) {
                allValues.push(value);
              }
            }
          }
        }

        if (allValues.length === 0) {
          setGlobalStats({ percentile99: 5000 });
          return;
        }

        allValues.sort((a, b) => a - b);
        const index99 = Math.floor(allValues.length * 0.999);
        const percentile99 = allValues[index99] || 5000;

        setGlobalStats({ percentile99 });
      };

      calculateStats();
    }
  }, [isPreview, data, metadata]);

  // Render the image data to the canvas
  useEffect(() => {
    if (!data || !metadata || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const samples = parseInt(metadata.samples, 10);
    const lines = parseInt(metadata.lines, 10);

    if (isNaN(samples) || isNaN(lines)) return;

    canvas.width = samples;
    canvas.height = lines;

    const imageData = ctx.createImageData(samples, lines);

    // Get the appropriate bands to render
    const redIndex = isPreview ? 0 : bands.red - 1;
    const greenIndex = isPreview ? 1 : bands.green - 1;
    const blueIndex = isPreview ? 2 : bands.blue - 1;

    console.log(`Rendering bands R:${redIndex + 1}, G:${greenIndex + 1}, B:${blueIndex + 1}`);

    // Calculate band statistics with a more robust approach that uses user-defined percentiles
    const calculateBandStats = (bandData) => {
      if (!bandData) return { min: 0, max: 65535 };

      // Sample values for performance
      const values = [];
      const sampleRate = 0.2;
      const ignoreValue = parseFloat(metadata["data ignore value"] || -1);

      for (let line = 0; line < lines; line++) {
        if (Math.random() > sampleRate) continue;
        for (let sample = 0; sample < samples; sample++) {
          if (Math.random() > sampleRate) continue;
          if (bandData[line] && bandData[line][sample] !== undefined) {
            const value = bandData[line][sample];

            // Skip data ignore values
            if (value !== ignoreValue && value < 55536 && value >= 0) {
              values.push(value);
            }
          }
        }
      }

      if (values.length === 0) {
        return { min: 0, max: globalStats.percentile99 || 65535 };
      }

      values.sort((a, b) => a - b);

      // Use user-controlled percentiles
      const lowerIndex = Math.floor(values.length * normalizationSettings.lowerPercentile);
      const upperIndex = Math.floor(values.length * normalizationSettings.upperPercentile);

      // Ensure we have a reasonable range - at least 10% of max value
      const min = values[lowerIndex] || 0;
      const max = Math.max(values[upperIndex] || 1, min + 1);

      console.log(`Band stats - min: ${min}, max: ${max}, samples: ${values.length}`);

      return { min, max };
    };

    // Calculate stats for each band and ensure they have a reasonable range
    const bandStats = {
      red: calculateBandStats(data[redIndex]),
      green: calculateBandStats(data[greenIndex]),
      blue: calculateBandStats(data[blueIndex])
    };

    // Log the statistics to help debug
    console.log('Band stats:', bandStats);

    // Normalize function with user-controlled gamma correction
    const normalize = (value, min, max, sample, line, samples, lines) => {
      // Check if this is an edge pixel
      const isEdgePixel = (sample === 0 || sample === samples - 1 ||
        line === 0 || line === lines - 1);

      // Check for extreme values that likely represent no data
      const isNoDataValue = (value > 55536 || value < 1);

      // If it's an edge pixel or a no-data value, return 0
      if (isEdgePixel || isNoDataValue) return 0;

      // Otherwise, proceed with normal normalization
      const range = max - min;
      if (range <= 0) return 0;

      let normalized = (value - min) / range;
      normalized = Math.max(0, Math.min(1, normalized));
      normalized = Math.pow(normalized, normalizationSettings.gamma);

      return Math.floor(normalized * 255);
    };


    // Process each pixel in a single loop
    for (let i = 0; i < samples * lines; i++) {
      const line = Math.floor(i / samples);
      const sample = i % samples;

      try {
        // Get values for each band
        const redValue = data[redIndex][line][sample];
        const greenValue = data[greenIndex][line][sample];
        const blueValue = data[blueIndex][line][sample];

        // Check for data ignore value if specified
        const ignoreValue = parseFloat(metadata["data ignore value"] || -1);
        const isIgnored = (redValue === ignoreValue || greenValue === ignoreValue || blueValue === ignoreValue);

        if (isIgnored) {
          // Use black for ignored values
          imageData.data[i * 4 + 0] = 0;
          imageData.data[i * 4 + 1] = 0;
          imageData.data[i * 4 + 2] = 0;
          imageData.data[i * 4 + 3] = 255;
        } else {
          // Normalize each band separately
          const normRed = normalize(redValue, bandStats.red.min, bandStats.red.max);
          const normGreen = normalize(greenValue, bandStats.green.min, bandStats.green.max);
          const normBlue = normalize(blueValue, bandStats.blue.min, bandStats.blue.max);

          // Apply values to the image data
          imageData.data[i * 4 + 0] = normRed;
          imageData.data[i * 4 + 1] = normGreen;
          imageData.data[i * 4 + 2] = normBlue;
          imageData.data[i * 4 + 3] = 255;
        }
      } catch (error) {
        // Handle any errors by setting pixel to black
        imageData.data[i * 4 + 0] = 0;
        imageData.data[i * 4 + 1] = 0;
        imageData.data[i * 4 + 2] = 0;
        imageData.data[i * 4 + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }, [data, metadata, isPreview, bands, globalStats, normalizationSettings]);

  // Pixel click
  const handlePixelClick = useCallback((event) => {
    if (!data || !metadata || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = Math.floor((event.clientX - rect.left) * scaleX);
    const y = Math.floor((event.clientY - rect.top) * scaleY);

    // Bounds check
    if (x < 0 || x >= metadata.samples || y < 0 || y >= metadata.lines) {
      return;
    }

    // Only collect spectrum data if we have the full dataset
    if (!isPreview) {
      const pixelSpectrum = [];
      const wavelengthData = metadata.wavelengthValues || [];

      // Collect spectral data for all bands
      for (let band = 0; band < metadata.bands; band++) {
        if (data[band] && data[band][y] && data[band][y][x] !== undefined) {
          const value = data[band][y][x];

          // Skip extreme values that likely represent no data
          if (value >= 55536 || value < 1) {
            // Either skip this band or set value to 0
            const fixedValue = 0; // Set to 0 instead of skipping
            const wavelength = wavelengthData[band] || band + 1;

            pixelSpectrum.push({
              band: band + 1,
              wavelength,
              value: fixedValue
            });
          } else {
            // Normal values
            const wavelength = wavelengthData[band] || band + 1;
            pixelSpectrum.push({
              band: band + 1,
              wavelength,
              value
            });
          }
        }
      }

      // Generate a random color for this new spectrum
      const randomColor = `rgb(${Math.floor(Math.random() * 200)}, ${Math.floor(Math.random() * 200)}, ${Math.floor(Math.random() * 200)})`;

      const newSpectralData = {
        spectrum: pixelSpectrum,
        position: { x, y },
        color: randomColor
      };

      // Add to the array instead of replacing
      setSpectralDataArray(prevArray => [...prevArray, newSpectralData]);
      setShowSpectralGraph(true);
    }
  }, [data, metadata, isPreview]);

  // Set up event listeners
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.addEventListener('click', handlePixelClick);

    return () => {
      canvas.removeEventListener('click', handlePixelClick);
    };
  }, [handlePixelClick]);

  // clicking outside the graph
  useEffect(() => {
    if (!showSpectralGraph) return;

    const handleOutsideClick = (event) => {
      const isClickOnGraph = event.target.closest('.spectral-graph');
      const isClickOnCanvas = event.target.closest('canvas');

      if (!isClickOnGraph && !isClickOnCanvas) {
        // Now we close the graph but don't clear the data
        setShowSpectralGraph(false);
      }
    };

    document.addEventListener('click', handleOutsideClick);

    return () => {
      document.removeEventListener('click', handleOutsideClick);
    };
  }, [showSpectralGraph]);

  const clearAllSpectra = () => {
    setSpectralDataArray([]);
    setShowSpectralGraph(false);
  };

  // Handle form submission for band selection
  const handleSubmit = (e) => {
    e.preventDefault();
    const form = e.target;
    const redBand = parseInt(form.red.value, 10);
    const greenBand = parseInt(form.green.value, 10);
    const blueBand = parseInt(form.blue.value, 10);

    // Validate bands
    const maxBand = metadata.bands;
    const isValid =
      !isNaN(redBand) && redBand >= 1 && redBand <= maxBand &&
      !isNaN(greenBand) && greenBand >= 1 && greenBand <= maxBand &&
      !isNaN(blueBand) && blueBand >= 1 && blueBand <= maxBand;

    if (isValid) {
      setBands({ red: redBand, green: greenBand, blue: blueBand });
    } else {
      alert(`Please enter valid band numbers between 1 and ${maxBand}`);
    }
  };

  // Calculate spectral graph popup position
  const calculatePopupPosition = useCallback(() => {
    if (!spectralDataArray) return {};

    // Fixed position in the bottom left
    const graphWidth = 320;
    const graphHeight = 240;

    // Add some padding from the edges
    const left = 20;
    const top = window.innerHeight - graphHeight - 130;

    return {
      position: 'fixed',
      left: left + 'px',
      top: top + 'px',
      zIndex: 1000
    };
  }, [spectralDataArray]); // Keep the spectralData dependency for consistency

  // Helper to get wavelength for a band
  const getWavelengthForBand = useCallback((bandNumber) => {
    if (!metadata || !metadata.wavelengthValues ||
      bandNumber < 1 || bandNumber > metadata.bands) {
      return null;
    }
    return metadata.wavelengthValues[bandNumber - 1];
  }, [metadata]);

  // Format wavelength value for display
  const formatWavelength = useCallback((wavelength) => {
    if (wavelength === null || wavelength === undefined) return '';

    if (wavelength < 10) {
      return `${wavelength.toFixed(3)} μm`;
    }
    return `${Math.round(wavelength)} nm`;
  }, []);

  // Normalization Controls component
  const NormalizationControls = () => (
    <div className="mt-4 p-4 bg-gray-50 rounded-lg">
      <h4 className="font-semibold mb-2">Image Enhancement Controls</h4>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Lower Cutoff ({Math.round(normalizationSettings.lowerPercentile * 100)}%)
          </label>
          <input
            type="range"
            min="0"
            max="10"
            step="0.5"
            value={normalizationSettings.lowerPercentile * 100}
            onChange={(e) => setNormalizationSettings({
              ...normalizationSettings,
              lowerPercentile: Number(e.target.value) / 100
            })}
            className="w-full"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Upper Cutoff ({Math.round(normalizationSettings.upperPercentile * 100)}%)
          </label>
          <input
            type="range"
            min="90"
            max="100"
            step="0.5"
            value={normalizationSettings.upperPercentile * 100}
            onChange={(e) => setNormalizationSettings({
              ...normalizationSettings,
              upperPercentile: Number(e.target.value) / 100
            })}
            className="w-full"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Gamma ({normalizationSettings.gamma.toFixed(2)})
          </label>
          <input
            type="range"
            min="0.2"
            max="2.0"
            step="0.05"
            value={normalizationSettings.gamma}
            onChange={(e) => setNormalizationSettings({
              ...normalizationSettings,
              gamma: Number(e.target.value)
            })}
            className="w-full"
          />
        </div>
      </div>


    </div>
  );
  // Memoized spectral graph rendering
  const spectralGraph = useMemo(() => {
    if (!showSpectralGraph || spectralDataArray.length === 0) {
      return null;
    }

    // Calculate overall min/max values from all spectra
    let spectrumMin = Infinity;
    let spectrumMax = -Infinity;

    spectralDataArray.forEach(data => {
      if (!data.spectrum) return;

      data.spectrum.forEach(point => {
        if (point.value < spectrumMin) spectrumMin = point.value;
        if (point.value > spectrumMax) spectrumMax = point.value;
      });
    });

    // Add 10% padding to max value and ensure min is at least 0
    const minValue = Math.max(0, spectrumMin * 0.9);
    const maxValue = spectrumMax * 1.1;

    // Calculate band positions for markers
    const bandPositions = {};
    if (metadata.wavelengthValues) {
      const wavelengths = metadata.wavelengthValues;
      const minWavelength = Math.min(...wavelengths);
      const maxWavelength = Math.max(...wavelengths);
      const range = maxWavelength - minWavelength;

      bandPositions.red = (wavelengths[bands.red - 1] - minWavelength) / range;
      bandPositions.green = (wavelengths[bands.green - 1] - minWavelength) / range;
      bandPositions.blue = (wavelengths[bands.blue - 1] - minWavelength) / range;
    } else {
      bandPositions.red = (bands.red - 1) / (metadata.bands - 1);
      bandPositions.green = (bands.green - 1) / (metadata.bands - 1);
      bandPositions.blue = (bands.blue - 1) / (metadata.bands - 1);
    }

    // Chart dimensions
    const chartWidth = 300;
    const chartHeight = 200;
    const paddingX = 50;
    const paddingY = 30;
    const graphWidth = chartWidth - (paddingX * 2);
    const graphHeight = chartHeight - (paddingY * 2);

    // X-axis tick values based on the first spectrum (they all have same bands)
    const firstSpectrum = spectralDataArray[0]?.spectrum || [];
    const xTickCount = Math.min(9, firstSpectrum.length);
    const xTicks = [];

    if (firstSpectrum.length > 0) {
      const wavelengthValues = firstSpectrum.map(d => d.wavelength);
      const minWavelength = Math.min(...wavelengthValues);
      const maxWavelength = Math.max(...wavelengthValues);
      const hasRealWavelengthData = wavelengthValues.length > 0 && wavelengthValues[0] !== undefined;

      if (hasRealWavelengthData) {
        // Create evenly spaced ticks from min to max
        for (let i = 0; i < xTickCount; i++) {
          const wavelengthValue = minWavelength + (i / (xTickCount - 1)) * (maxWavelength - minWavelength);
          const xPosition = paddingX + (i / (xTickCount - 1)) * graphWidth;

          const integerValue = Math.round(wavelengthValue);

          xTicks.push({
            x: xPosition,
            value: integerValue >= 10 ? integerValue : wavelengthValue.toFixed(2)
          });
        }
      } else {
        // Fallback to band-based ticks
        for (let i = 0; i < xTickCount; i++) {
          const bandNum = Math.floor(1 + i * (firstSpectrum.length - 1) / (xTickCount - 1));
          const xPosition = paddingX + (i / (xTickCount - 1)) * graphWidth;

          xTicks.push({
            x: xPosition,
            value: bandNum
          });
        }
      }
    }

    console.log(firstSpectrum[0].wavelength);

    const xAxisLabel = firstSpectrum.length > 0 &&
      firstSpectrum[0].wavelength !== undefined ?
      firstSpectrum[0].wavelength < 3.0 ? "Wavelength (µm)" : "Wavelength (nm)" // assumed to be µm if <3
      : "Band";

    // Y-axis tick values
    const yTickCount = 5;
    const yTicks = [];

    for (let i = 0; i < yTickCount; i++) {
      const value = 0 + (i / (yTickCount - 1)) * (maxValue - minValue);
      const y = paddingY + graphHeight - (i / (yTickCount - 1)) * graphHeight;

      yTicks.push({
        y,
        value: Math.round(value)
      });
    }

    // Function to remove a specific spectrum
    const removeSpectrum = (index) => {

      const newArray = [...spectralDataArray];

      newArray.splice(index, 1);

      setSpectralDataArray(newArray);

    };

    const handleMouseMove = (e) => {
      const svgRect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - svgRect.left;

      if (x >= paddingX && x <= paddingX + graphWidth) {
        setCursorPosition(x);

        // Find datapoints across all spectra at this position
        const relativeX = (x - paddingX) / graphWidth;

        // Find which dataset's point to highlight
        spectralDataArray.forEach((specData, specIndex) => {
          if (!specData.spectrum) return;

          const sortedData = [...specData.spectrum].sort((a, b) => a.wavelength - b.wavelength);
          const dataIndex = Math.floor(relativeX * (sortedData.length - 1));

          if (dataIndex >= 0 && dataIndex < sortedData.length) {
            const value = sortedData[dataIndex].value;
            const wavelength = sortedData[dataIndex].wavelength;
            const xPos = paddingX + (dataIndex / (sortedData.length - 1)) * graphWidth;
            const yPos = paddingY + graphHeight - ((value - minValue) / (maxValue - minValue) * graphHeight);

            // Update hover data for this spectrum
            specData.hoverPoint = {
              value,
              wavelength,
              x: xPos,
              y: yPos
            };
          }
        });

        // Force re-render by updating a state variable
        setHoveredPoint({ x, values: spectralDataArray.map(d => d.hoverPoint) });
      }
    };

    const handleMouseLeave = () => {
      setCursorPosition(null);
      setHoveredPoint(null);

      // Clear all hover points
      spectralDataArray.forEach(specData => {
        specData.hoverPoint = null;
      });
    };

    return (
      <div className="spectral-graph fixed bg-white border border-gray-300 shadow-lg p-4" style={calculatePopupPosition()}>
        <div className="flex justify-between items-center mb-2">
          <h3 className="text-sm font-semibold">
            Spectral Profiles ({spectralDataArray.length} pixels)
          </h3>
          <div>
            <button
              className="text-red-500 hover:text-red-700 mx-2"
              onClick={clearAllSpectra}
            >
              Clear All
            </button>
            <button
              className="text-gray-500 hover:text-gray-700"
              onClick={() => setShowSpectralGraph(false)}
            >
              ×
            </button>
          </div>
        </div>
        <svg ref={svgRef} width={chartWidth} height={chartHeight} className="bg-gray-50" onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}>
          {/* Grid lines */}
          {yTicks.map((tick, i) => (
            <line
              key={`y-grid-${i}`}
              x1={paddingX}
              y1={tick.y}
              x2={paddingX + graphWidth}
              y2={tick.y}
              stroke="#ddd"
              strokeWidth="1"
            />
          ))}

          {xTicks.map((tick, i) => (
            <line
              key={`x-grid-${i}`}
              x1={tick.x}
              y1={paddingY}
              x2={tick.x}
              y2={paddingY + graphHeight}
              stroke="#ddd"
              strokeWidth="1"
            />
          ))}

          {/* X axis line */}
          <line x1={paddingX} y1={paddingY + graphHeight} x2={paddingX + graphWidth} y2={paddingY + graphHeight} stroke="#333" strokeWidth="1" />

          {/* Y axis line */}
          <line x1={paddingX} y1={paddingY} x2={paddingX} y2={paddingY + graphHeight} stroke="#333" strokeWidth="1" />

          {/* X-axis ticks & labels */}
          {xTicks.map((tick, i) => (
            <React.Fragment key={`x-tick-${i}`}>
              <line x1={tick.x} y1={paddingY + graphHeight} x2={tick.x} y2={paddingY + graphHeight + 5} stroke="#333" strokeWidth="1" />
              <text x={tick.x} y={paddingY + graphHeight + 15} fontSize="10" textAnchor="middle">{tick.value}</text>
            </React.Fragment>
          ))}

          {/* Y-axis ticks & labels */}
          {yTicks.map((tick, i) => (
            <React.Fragment key={`y-tick-${i}`}>
              <line x1={paddingX - 5} y1={tick.y} x2={paddingX} y2={tick.y} stroke="#333" strokeWidth="1" />
              <text x={paddingX - 8} y={tick.y + 3} fontSize="10" textAnchor="end">{tick.value}</text>
            </React.Fragment>
          ))}

          {/* Data lines for each spectrum */}
          {spectralDataArray.map((specData, specIndex) => {
            if (!specData.spectrum || specData.spectrum.length === 0) return null;

            // Sort by wavelength for proper display
            const sortedData = [...specData.spectrum].sort((a, b) => a.wavelength - b.wavelength);

            // Generate points for line
            const points = sortedData.map((point, index) => {
              const x = paddingX + (index / (sortedData.length - 1)) * graphWidth;
              const y = paddingY + graphHeight - ((point.value - minValue) / (maxValue - minValue) * graphHeight);
              return `${x},${y}`;
            }).join(' ');

            return (
              <React.Fragment key={`spectrum-${specIndex}`}>
                <polyline points={points} fill="none" stroke={specData.color} strokeWidth="2" />

                {/* Hover point for this spectrum */}
                {specData.hoverPoint && (
                  <circle
                    cx={specData.hoverPoint.x}
                    cy={specData.hoverPoint.y}
                    r="3"
                    fill={specData.color}
                    stroke="#fff"
                    strokeWidth="1"
                  />
                )}
              </React.Fragment>
            );
          })}

          {/* RGB band markers */}
          <line x1={paddingX + (bandPositions.red * graphWidth)} y1={paddingY} x2={paddingX + (bandPositions.red * graphWidth)}
            y2={paddingY + graphHeight} stroke="rgba(255, 0, 0, 0.7)" strokeWidth="1" strokeDasharray="4,2" />
          <line x1={paddingX + (bandPositions.green * graphWidth)} y1={paddingY} x2={paddingX + (bandPositions.green * graphWidth)}
            y2={paddingY + graphHeight} stroke="rgba(0, 180, 0, 0.7)" strokeWidth="1" strokeDasharray="4,2" />
          <line x1={paddingX + (bandPositions.blue * graphWidth)} y1={paddingY} x2={paddingX + (bandPositions.blue * graphWidth)}
            y2={paddingY + graphHeight} stroke="rgba(0, 0, 255, 0.7)" strokeWidth="1" strokeDasharray="4,2" />

          {/* Cursor examine line */}
          {cursorPosition && (
            <line x1={cursorPosition} y1={paddingY} x2={cursorPosition} y2={paddingY + graphHeight} stroke="#999" strokeWidth="1" strokeDasharray="2,2" />
          )}

          {/* Axis labels */}
          <text x={chartWidth / 2} y={chartHeight - 5} fontSize="10" textAnchor="middle">{xAxisLabel}</text>
          <text x={15} y={paddingY + (graphHeight / 2)} fontSize="10" textAnchor="middle"
            transform={`rotate(-90, 15, ${paddingY + (graphHeight / 2)})`}>Digital Number (DN)</text>
        </svg>

        {/* Legend area with remove buttons */}
        <div className="mt-2 max-h-20 overflow-y-auto">
          {spectralDataArray.map((specData, index) => (
            <div key={`legend-${index}`} className="flex items-center justify-between text-xs mb-1">
              <div className="flex items-center">
                <div
                  className="w-3 h-3 mr-1"
                  style={{ backgroundColor: specData.color }}
                ></div>
                <span>
                  Pixel ({specData.position.x}, {specData.position.y})
                  {specData.hoverPoint && ` - ${Math.round(specData.hoverPoint.value)}`}
                </span>
              </div>
              <button
                className="text-gray-500 hover:text-red-500 ml-2"
                onClick={() => removeSpectrum(index)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }, [spectralDataArray, showSpectralGraph, metadata, bands, globalStats, calculatePopupPosition, hoveredPoint, cursorPosition]);

  return (
    <div className="relative">
      {!isPreview && (
        <>
          {/* Band Selection Controls */}
          <div className="mb-4 p-4 bg-gray-50 rounded-lg">
            <h4 className="font-semibold mb-2">Band Selection</h4>
            <form onSubmit={handleSubmit} className="flex gap-4">
              <div className="flex items-center">
                <label className="mr-2 font-medium text-red-600">R:</label>
                <input
                  type="number"
                  name="red"
                  className="border rounded px-2 py-1 w-16"
                  defaultValue={bands.red}
                  min="1"
                  max={metadata?.bands || 100}
                />
                <span className="ml-2 text-sm text-red-600">
                  {formatWavelength(getWavelengthForBand(bands.red))}
                </span>
              </div>
              <div className="flex items-center">
                <label className="mr-2 font-medium text-green-600">G:</label>
                <input
                  type="number"
                  name="green"
                  className="border rounded px-2 py-1 w-16"
                  defaultValue={bands.green}
                  min="1"
                  max={metadata?.bands || 100}
                />
                <span className="ml-2 text-sm text-green-600">
                  {formatWavelength(getWavelengthForBand(bands.green))}
                </span>
              </div>
              <div className="flex items-center">
                <label className="mr-2 font-medium text-blue-600">B:</label>
                <input
                  type="number"
                  name="blue"
                  className="border rounded px-2 py-1 w-16"
                  defaultValue={bands.blue}
                  min="1"
                  max={metadata?.bands || 100}
                />
                <span className="ml-2 text-sm text-blue-600">
                  {formatWavelength(getWavelengthForBand(bands.blue))}
                </span>
              </div>
              <button
                type="submit"
                className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded"
              >
                Update
              </button>
            </form>
          </div>

          {/* Normalization controls */}
          <NormalizationControls />
        </>
      )}

      <canvas ref={canvasRef} style={{ cursor: 'crosshair' }} />

      {/* Spectral graph popup */}
      {spectralGraph}
    </div>
  );
};

export default ImageRenderer;