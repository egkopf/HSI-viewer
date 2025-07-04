# Hyperspectral Data Frontend Viewer

The **Frontend Viewer for Hyperspectral Data** is a component of the Hyperspectral Imaging Open Ecosystem lab at Yale University. The Viewer was developed by Ethan Kopf, Bai Xue, and Malia Kuo.

The Viewer uses React with Create React App (CRA), JavaScript, and HTML/CSS to create a web-based viewer for hyperspectral imaging data that supports file parsing, image rendering, and interactive spectral profile analysis.

## Getting Started

### Development

First, run the development server:

```bash
npm start
# or
yarn start
# or
pnpm start
# or
bun start
```

Then open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

### Production Build

To create an optimized production build:

```bash
npm run build
# or
yarn build
# or
pnpm build
# or
bun run build
```

This will create a `build` folder containing the optimized production build.

### Running Production Build

After building, you can serve the production build using a static file server:

```bash
# Install serve globally if not already installed
npm install -g serve

# Serve the build folder
serve -s build
```

The production server will be available at http://localhost:3000.

## Test Data

For example files to test the viewer on, visit and download datasets from the HSI-OSE dashboard:

https://hsi.yale.edu/hsi-dashboard
