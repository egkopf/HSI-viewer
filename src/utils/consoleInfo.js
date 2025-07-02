// Utility function to generate a summary of hyperspectral metadata
export function generateMetadataSummary(metadata) {
  if (!metadata) {
    return "No metadata available";
  }

  const {
    samples,
    lines,
    bands,
    dataType,
    interleave,
    byteOrder,
    isBigEndian,
    defaultBands,
    wavelengthValues,
    ...otherFields
  } = metadata;

  // Calculate total pixels and file size estimate
  const totalPixels = (samples || 0) * (lines || 0);
  const bytesPerPixel = dataType === 4 ? 4 : 2; // 4 for float32, 2 for uint16
  const estimatedSizeMB = (totalPixels * (bands || 0) * bytesPerPixel) / (1024 * 1024);

  // Format wavelength range
  const getWavelengthInfo = () => {
    if (!wavelengthValues || wavelengthValues.length === 0) {
      return "No wavelength data";
    }
    const min = Math.min(...wavelengthValues);
    const max = Math.max(...wavelengthValues);
    const unit = max < 10 ? "μm" : "nm";
    return `${min.toFixed(2)} - ${max.toFixed(2)} ${unit}`;
  };

  // Format default bands with wavelengths if available
  const getDefaultBandsInfo = () => {
    if (!defaultBands || defaultBands.length === 0) {
      return "None specified";
    }
    
    if (wavelengthValues && wavelengthValues.length > 0) {
      return defaultBands.map((band, idx) => {
        const wavelength = wavelengthValues[band - 1];
        const color = ['R', 'G', 'B'][idx] || '';
        const unit = wavelength < 10 ? "μm" : "nm";
        return `${color}:${band} (${wavelength?.toFixed(2)} ${unit})`;
      }).join(", ");
    } else {
      return defaultBands.map((band, idx) => {
        const color = ['R', 'G', 'B'][idx] || '';
        return `${color}:${band}`;
      }).join(", ");
    }
  };

  // Create summary object
  const summary = {
    // Image dimensions
    dimensions: `${samples || 'Unknown'} × ${lines || 'Unknown'} pixels`,
    spectralBands: bands || 'Unknown',
    totalPixels: totalPixels.toLocaleString(),
    estimatedSize: `${estimatedSizeMB.toFixed(1)} MB`,
    
    // Data format
    dataFormat: {
      interleave: interleave || 'Unknown',
      dataType: dataType === 4 ? 'Float32' : dataType === 12 ? 'Uint16' : `Type ${dataType}`,
      byteOrder: isBigEndian ? 'Big Endian' : 'Little Endian'
    },
    
    // Spectral info
    spectralRange: getWavelengthInfo(),
    defaultBands: getDefaultBandsInfo(),
    
    // Additional fields
    otherInfo: Object.keys(otherFields).length > 0 ? otherFields : null
  };

  return summary;
}

// Function to format summary as readable text
export function formatMetadataSummary(metadata) {
  const summary = generateMetadataSummary(metadata);
  
  if (typeof summary === 'string') {
    return summary;
  }

  let output = "HYPERSPECTRAL DATA SUMMARY\n";
  output += "=" + "=".repeat(28) + "\n\n";
  
  output += `Image Size: ${summary.dimensions}\n`;
  output += `Total Pixels: ${summary.totalPixels}\n`;
  output += `Spectral Bands: ${summary.spectralBands}\n`;
  output += `Estimated File Size: ${summary.estimatedSize}\n\n`;
  
  output += "DATA FORMAT:\n";
  output += `  Interleave: ${summary.dataFormat.interleave}\n`;
  output += `  Data Type: ${summary.dataFormat.dataType}\n`;
  output += `  Byte Order: ${summary.dataFormat.byteOrder}\n\n`;
  
  output += "SPECTRAL INFO:\n";
  output += `  Wavelength Range: ${summary.spectralRange}\n`;
  output += `  Default RGB Bands: ${summary.defaultBands}\n`;
  
  if (summary.otherInfo) {
    output += "\nADDITIONAL FIELDS:\n";
    Object.entries(summary.otherInfo).forEach(([key, value]) => {
      // Truncate long array-like values or strings
      let displayValue = value;
      if (typeof value === 'string' && value.includes(',')) {
        const parts = value.split(',').map(s => s.trim());
        if (parts.length > 5) {
          displayValue = parts.slice(0, 5).join(', ') + ` ... (+${parts.length - 5} more)`;
        }
      } else if (Array.isArray(value) && value.length > 5) {
        displayValue = value.slice(0, 5).join(', ') + ` ... (+${value.length - 5} more)`;
      } else if (typeof value === 'string' && value.length > 100) {
        displayValue = value.substring(0, 97) + "...";
      }
      
      output += `  ${key}: ${displayValue}\n`;
    });
  }
  
  return output;
}

// Function to create a compact one-line summary
export function getCompactSummary(metadata) {
  if (!metadata) return "No data";
  
  const { samples, lines, bands, interleave } = metadata;
  return `${samples}×${lines} px, ${bands} bands, ${interleave?.toUpperCase() || 'Unknown'} format`;
}