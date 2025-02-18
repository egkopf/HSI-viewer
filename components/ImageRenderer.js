// components/ImageRenderer.js
import React, { useEffect, useRef, useState } from 'react';

const ImageRenderer = ({ data, metadata }) => {
  const canvasRef = useRef(null);
  let defaultBands = false;

  useEffect(() => {
    if (data && metadata) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      let defaultVals, defaultRed, defaultGreen, defaultBlue;

      const samples = parseInt(metadata.samples, 10);
      const lines = parseInt(metadata.lines, 10);

      if (metadata["default bands"]) {
        defaultBands = true;
        defaultVals = metadata["default bands"].replace(/[{}]/g, '').split(',').map(Number);
        defaultRed = defaultVals[0] - 1;
        defaultGreen = defaultVals[1] - 1;
        defaultBlue = defaultVals[2] - 1;
      } else {
        defaultBands = false;
      }

      if (isNaN(samples) || isNaN(lines)) {
        console.error('Invalid samples or lines values');
        return;
      }

      canvas.width = samples;
      canvas.height = lines;
      const imageData = ctx.createImageData(samples, lines);

      // Function to calculate percentiles for a band
      const calculatePercentiles = (bandIndex) => {
        // Collect all values from the band
        const values = [];
        for (let line = 0; line < lines; line++) {
          for (let sample = 0; sample < samples; sample++) {
            values.push(data[bandIndex][line][sample]);
          }
        }

        // Sort values for percentile calculation
        values.sort((a, b) => a - b);

        // Calculate 2nd and 98th percentiles
        const lowerIndex = Math.floor(values.length * 0.02);
        const upperIndex = Math.floor(values.length * 0.98);

        return {
          min: values[lowerIndex],
          max: values[upperIndex]
        };
      };

      // Get stats for the bands we'll display
      const bandStats = defaultBands ? {
        red: calculatePercentiles(defaultRed),
        green: calculatePercentiles(defaultGreen),
        blue: calculatePercentiles(defaultBlue)
      } : {
        gray: calculatePercentiles(0)
      };

      const normalize = (value, min, max) => {
        // Apply linear stretch between min and max with enhanced contrast
        let normalized = (value - min) / (max - min);

        // Clamp values between 0 and 1
        normalized = Math.max(0, Math.min(1, normalized));

        // Apply gamma correction for better visibility
        normalized = Math.pow(normalized, 0.8); // gamma value < 1 brightens the image

        // Scale to 0-255
        return Math.floor(normalized * 255);
      };

      // Process each pixel
      for (let i = 0; i < samples * lines; i++) {
        const line = Math.floor(i / samples);
        const sample = i % samples;

        if (defaultBands) {
          const redValue = data[defaultRed][line][sample];
          const greenValue = data[defaultGreen][line][sample];
          const blueValue = data[defaultBlue][line][sample];

          const normalizedRed = normalize(redValue, bandStats.red.min, bandStats.red.max);
          const normalizedGreen = normalize(greenValue, bandStats.green.min, bandStats.green.max);
          const normalizedBlue = normalize(blueValue, bandStats.blue.min, bandStats.blue.max);

          imageData.data[i * 4 + 0] = normalizedRed;
          imageData.data[i * 4 + 1] = normalizedGreen;
          imageData.data[i * 4 + 2] = normalizedBlue;
          imageData.data[i * 4 + 3] = 255;
        } else {
          const value = data[0][line][sample];
          const normalizedValue = normalize(value, bandStats.gray.min, bandStats.gray.max);

          imageData.data[i * 4 + 0] = normalizedValue;
          imageData.data[i * 4 + 1] = normalizedValue;
          imageData.data[i * 4 + 2] = normalizedValue;
          imageData.data[i * 4 + 3] = 255;
        }
      }

      ctx.putImageData(imageData, 0, 0);
    }
  }, [data, metadata]);

  return <canvas ref={canvasRef} />;
};

export default ImageRenderer;
