export async function parseHDRFile(hdrFile) {
  const text = await hdrFile.text();
  const metadata = {};

  text.split('\n').forEach((line) => {
    const [key, value] = line.split('=');
    if (key && value) {
      metadata[key.trim()] = value.trim();
    }
  });

  return {
    ...metadata,
    samples: parseInt(metadata.samples, 10),
    lines: parseInt(metadata.lines, 10),
    bands: parseInt(metadata.bands, 10),
  };
}

export async function parseRGBPreview(bsqFile, metadata, rgbBands) {
  const { samples, lines } = metadata;
  const buffer = await bsqFile.arrayBuffer();
  const view = new DataView(buffer);
  const bytesPerSample = 2;

  // Create array for just these 3 bands
  const previewData = [[], [], []];  // One array for each RGB band

  // Load each of the three bands we need
  for (let i = 0; i < 3; i++) {
    const bandNumber = rgbBands[i]; // This is the 1-based band number from metadata
    const bandIndex = i;  // This is the index in preview array (0, 1, or 2)

    // Initialize the 2D array for this band
    previewData[bandIndex] = Array(lines).fill().map(() => Array(samples).fill(0));

    // offset for this band in the file
    const bandOffset = (bandNumber - 1) * lines * samples * bytesPerSample;

    // Read the data for this band
    for (let line = 0; line < lines; line++) {
      for (let sample = 0; sample < samples; sample++) {
        const offset = bandOffset +
          line * samples * bytesPerSample +
          sample * bytesPerSample;

        previewData[bandIndex][line][sample] = view.getUint16(offset, true);
      }
    }
  }

  return previewData;
}

export async function parseFullBSQ(bsqFile, metadata, onProgress) {
  const { samples, lines, bands } = metadata;
  const buffer = await bsqFile.arrayBuffer();
  const view = new DataView(buffer);
  const bytesPerSample = 2;

  const data = [];

  for (let band = 0; band < bands; band++) {
    const bandData = [];
    for (let line = 0; line < lines; line++) {
      const lineData = [];
      for (let sample = 0; sample < samples; sample++) {
        const offset = band * lines * samples * bytesPerSample +
          line * samples * bytesPerSample +
          sample * bytesPerSample;
        lineData.push(view.getUint16(offset, true));
      }
      bandData.push(lineData);
    }
    data.push(bandData);

    // Report progress
    if (onProgress) {
      onProgress((band + 1) / bands * 100);
    }
  }

  return data;
}