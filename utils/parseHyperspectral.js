// utils/parseHyperspectral.js

export async function parseHDRFile(hdrFile) {
  const text = await hdrFile.text(); // Read the content of the HDR file as a string
  const metadata = {};

  // Parse the HDR file line by line
  text.split('\n').forEach((line) => {
    const [key, value] = line.split('=');
    if (key && value) {
      metadata[key.trim()] = value.trim();
    }
  });

  // Convert essential metadata into numbers (samples and lines)
  return {
    ...metadata,
    samples: parseInt(metadata.samples, 10),
    lines: parseInt(metadata.lines, 10),
    bands: parseInt(metadata.bands, 10),  // Assuming "bands" is provided in the hdr
  };
}

export async function parseBSQFile(bsqFile, metadata) {
  try {
    console.log('Starting BSQ parsing with metadata:', {
      samples: metadata.samples,
      lines: metadata.lines,
      bands: metadata.bands
    });

    const { samples, lines, bands } = metadata;
    const buffer = await bsqFile.arrayBuffer();
    const view = new DataView(buffer);

    console.log('Buffer size:', buffer.byteLength, 'bytes');
    console.log('Expected size:', samples * lines * bands * 2, 'bytes');

    const data = [];
    const bytesPerSample = 2;

    for (let band = 0; band < bands; band++) {
      if (band % 10 === 0) {
        console.log(`Processing band ${band}/${bands}`);
      }
      const bandData = [];
      for (let line = 0; line < lines; line++) {
        const lineData = [];
        for (let sample = 0; sample < samples; sample++) {
          const offset = band * lines * samples * bytesPerSample +
            line * samples * bytesPerSample +
            sample * bytesPerSample;
          if (offset >= buffer.byteLength) {
            throw new Error(`Buffer overflow at band ${band}, line ${line}, sample ${sample}, offset ${offset}`);
          }
          lineData.push(view.getUint16(offset, true));
        }
        bandData.push(lineData);
      }
      data.push(bandData);
    }

    console.log('BSQ parsing complete');
    return data;
  } catch (error) {
    console.error('Error parsing BSQ file:', error);
    throw error;
  }
}
