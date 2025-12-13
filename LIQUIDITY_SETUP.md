# Liquidity Pool Setup Guide

This guide explains how to set up and use the liquidity pool creation feature.

## TON API Key (Optional but Recommended)

The TON API key is **optional** - the app will work without it, but having one provides:

- Higher rate limits
- Better reliability
- Access to premium endpoints

### How to Get a Free TON API Key

1. **Visit TON Center**: Go to https://toncenter.com/
2. **Sign Up**: Create a free account
3. **Get API Key**:
   - Go to your dashboard
   - Navigate to "API Keys" section
   - Create a new API key
   - Copy the key

### Setting Up the API Key

1. **Create `.env` file** in the project root (if it doesn't exist)
2. **Add the following line**:
   ```
   REACT_APP_TON_API_KEY=your_api_key_here
   ```
3. **Replace `your_api_key_here`** with your actual API key
4. **Restart the development server** for changes to take effect

### Example `.env` file:

```
REACT_APP_TON_API_KEY=1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
```

## Using the Liquidity Feature

1. Navigate to `/liquidity` page
2. Connect your TON wallet
3. Enter your token's Jetton Master address
4. Enter the TON amount you want to add
5. Choose between:
   - **STON.fi Web Interface** (Recommended): Redirects to STON.fi for safe transaction handling
   - **Direct Contract Interaction**: Uses SDK to create transactions directly

## Features

- ✅ Automatic pool detection (existing vs new pools)
- ✅ Uses official STON.fi SDK and API
- ✅ Handles both TON and Jetton tokens
- ✅ Simulation before execution
- ✅ Works on mainnet and testnet

## Troubleshooting

### Build Errors

If you encounter build errors, make sure:

- All dependencies are installed: `npm install`
- TypeScript version is compatible
- Node.js version is 16+

### API Key Issues

- The API key is optional - the app works without it
- If you get rate limit errors, add an API key
- Make sure `.env` file is in the project root
- Restart dev server after adding `.env` file

### Transaction Errors

- Ensure you have enough TON for gas fees (~0.1-0.2 TON)
- Make sure you have the token balance if adding to existing pool
- Check that token address is correct (Jetton Master address)

## Resources

- STON.fi Documentation: https://docs.ston.fi/
- TON Center: https://toncenter.com/
- STON.fi Liquidity Guide: https://docs.ston.fi/developer-section/quickstart/liquidity
