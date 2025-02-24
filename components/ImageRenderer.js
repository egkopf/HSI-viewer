import React, { useEffect, useRef, useState } from 'react';

const ImageRenderer = ({ data, metadata, isPreview }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (data && metadata) {
      console.log(`Rendering ${isPreview ? 'preview' : 'full'} data`);
      console.log('Data structure:', {
        numberOfBands: data.length,
        bandSize: data[0]?.length,
        lineSize: data[0]?.[0]?.length
      });

      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      let defaultBands = false;
      let defaultVals, defaultRed, defaultGreen, defaultBlue;

      const samples = parseInt(metadata.samples, 10);
      const lines = parseInt(metadata.lines, 10);

      // Checking to see if .hdr has default bands for visualization
      if (metadata["default bands"]) {
        defaultBands = true;
        defaultVals = metadata["default bands"].replace(/[{}]/g, '').split(',').map(Number);
        if (isPreview) {
          // For preview, data is already in RGB order
          defaultRed = 0;
          defaultGreen = 1;
          defaultBlue = 2;
          console.log('Using preview band indices:', { defaultRed, defaultGreen, defaultBlue });
        } else {
          // For full data, need to use actual band numbers (converting to 0-based)
          defaultRed = defaultVals[0] - 1;
          defaultGreen = defaultVals[1] - 1;
          defaultBlue = defaultVals[2] - 1;
          console.log('Using full data band indices:', { defaultRed, defaultGreen, defaultBlue });
        }
      }

      if (isNaN(samples) || isNaN(lines)) {
        console.error('Invalid samples or lines values');
        return;
      }

      // Set canvas dimensions
      canvas.width = samples;
      canvas.height = lines;

      // Create ImageData to manipulate pixel values
      const imageData = ctx.createImageData(samples, lines);

      // Calculate statistics for each band
      const getBandStats = (bandIndex) => {
        if (!data[bandIndex]) {
          console.error(`Band ${bandIndex} not found in data`);
          return { min: 0, max: 65535 };
        }

        const values = [];
        for (let line = 0; line < lines; line++) {
          for (let sample = 0; sample < samples; sample++) {
            if (data[bandIndex][line] && data[bandIndex][line][sample] !== undefined) {
              values.push(data[bandIndex][line][sample]);
            }
          }
        }

        if (values.length === 0) {
          console.error(`No valid values found in band ${bandIndex}`);
          return { min: 0, max: 65535 };
        }

        values.sort((a, b) => a - b);
        const lowerIndex = Math.floor(values.length * 0.02);
        const upperIndex = Math.floor(values.length * 0.98);

        return {
          min: values[lowerIndex],
          max: values[upperIndex]
        };
      };

      // Get stats for the bands we'll display
      const bandStats = defaultBands ? {
        red: getBandStats(defaultRed),
        green: getBandStats(defaultGreen),
        blue: getBandStats(defaultBlue)
      } : {
        gray: getBandStats(0)
      };

      console.log('Band statistics:', bandStats);

      // Normalize function with gamma correction
      const normalize = (value, min, max) => {
        let normalized = (value - min) / (max - min);
        normalized = Math.max(0, Math.min(1, normalized));
        normalized = Math.pow(normalized, 0.8);
        return Math.floor(normalized * 255);
      };

      // Process each pixel
      for (let i = 0; i < samples * lines; i++) {
        const line = Math.floor(i / samples);
        const sample = i % samples;

        if (defaultBands) {
          try {
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
          } catch (error) {
            console.error(`Error processing pixel at line ${line}, sample ${sample}:`, error);
            // Set to black if there's an error
            imageData.data[i * 4 + 0] = 0;
            imageData.data[i * 4 + 1] = 0;
            imageData.data[i * 4 + 2] = 0;
            imageData.data[i * 4 + 3] = 255;
          }
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
      console.log(`Finished rendering ${isPreview ? 'preview' : 'full'} data`);
    }
  }, [data, metadata, isPreview]);

  return <canvas ref={canvasRef} />;
};

export default ImageRenderer;