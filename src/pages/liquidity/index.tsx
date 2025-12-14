import { useState } from "react";
import { Address } from "ton";
import { Box, Fade, Link, Typography } from "@mui/material";
import { useTonAddress, useTonConnectUI } from "@tonconnect/ui-react";
import {
  FormWrapper,
  ScreenHeading,
  StyledDescription,
  SubHeadingWrapper,
} from "../deployer/styles";
import { Screen, ScreenContent } from "components/Screen";
import useNotification from "hooks/useNotification";
import { isValidAddress } from "utils";
import { stonFiService } from "services/stonfi-service";
import { AppButton } from "components/appButton";
import { AppTextInput } from "components/appInput";
import { AppNumberInput } from "components/appInput";
import { AppHeading } from "components/appHeading";
import { useNetwork } from "lib/hooks/useNetwork";

function LiquidityPage() {
  const { showNotification } = useNotification();
  const walletAddress = useTonAddress();
  const [tonConnectUI] = useTonConnectUI();
  const [isLoading, setIsLoading] = useState(false);
  const { network } = useNetwork();

  const [tokenAddress, setTokenAddress] = useState<string>("");
  const [tonAmount, setTonAmount] = useState<number | undefined>(undefined);
  const [tokenAmount, setTokenAmount] = useState<number | undefined>(undefined);
  const [useDeepLink, setUseDeepLink] = useState(true); // Default to deep link method

  const isMainnet = network === "mainnet";

  async function handleCreatePool() {
    if (!walletAddress || !tonConnectUI) {
      showNotification("Please connect your wallet first", "warning");
      return;
    }

    if (!tokenAddress || !isValidAddress(tokenAddress)) {
      showNotification("Please enter a valid token address", "error");
      return;
    }

    if (!tonAmount || tonAmount <= 0) {
      showNotification("Please enter a valid TON amount", "error");
      return;
    }

    setIsLoading(true);

    try {
      const tokenAddr = Address.parse(tokenAddress);

      if (useDeepLink) {
        // Use deep link method - redirect to STON.fi
        const deepLink = stonFiService.getStonFiDeepLink(tokenAddress, tonAmount.toString());
        window.open(deepLink, "_blank");
        showNotification(
          "Redirecting to STON.fi to create/add liquidity. Please complete the transaction there.",
          "info",
          undefined,
          5000,
        );
      } else {
        // Direct contract interaction method
        const poolExists = await stonFiService.checkPoolExists(tokenAddr);

        if (poolExists) {
          showNotification("Pool already exists. Adding liquidity...", "info");
        } else {
          showNotification("Creating new pool and adding liquidity...", "info");
        }

        await stonFiService.createPoolAndAddLiquidity(
          {
            tokenAddress: tokenAddr,
            tonAmount: tonAmount.toString(),
            tokenAmount: tokenAmount?.toString(),
            walletAddress: walletAddress,
          },
          tonConnectUI,
        );

        showNotification(
          `Successfully ${poolExists ? "added liquidity to" : "created pool and added liquidity"}!`,
          "success",
          undefined,
          5000,
        );
      }
    } catch (err) {
      if (err instanceof Error) {
        showNotification(err.message, "error");
      } else {
        showNotification("Failed to create pool. Please try again.", "error");
      }
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Screen>
      <ScreenContent removeBackground>
        <Fade in>
          <Box>
            <Box mb={3} mt={3.75}>
              <ScreenHeading variant="h5">Create Liquidity Pool</ScreenHeading>
            </Box>
            <FormWrapper>
              <SubHeadingWrapper>
                <Box sx={{ padding: 3 }}>
                  <AppHeading
                    text="Pool Configuration"
                    variant="h4"
                    fontWeight={800}
                    fontSize={20}
                    marginBottom={20}
                    color="#161C28"
                  />

                  {!isMainnet && (
                    <Box
                      mb={2}
                      p={2}
                      sx={{ background: "#fff3cd", borderRadius: 2, border: "1px solid #ffc107" }}>
                      <Typography variant="body2" color="#856404">
                        ⚠️ You are currently on testnet. Remove "?testnet=true" from URL or click
                        "Switch to Mainnet" in footer to use mainnet.
                      </Typography>
                    </Box>
                  )}

                  <Box mb={3}>
                    <AppTextInput
                      fullWidth
                      label="Token Address (Jetton Master)"
                      value={tokenAddress}
                      onChange={(e: any) => setTokenAddress(e.target.value)}
                    />
                    <Typography
                      variant="caption"
                      color="#728A96"
                      sx={{ mt: 0.5, display: "block" }}>
                      Enter the Jetton Master contract address of the token you want to pair with
                      TON (e.g., EQD...)
                    </Typography>
                  </Box>

                  <Box mb={3}>
                    <AppNumberInput
                      label="TON Amount"
                      onChange={(value: number) => setTonAmount(value)}
                      value={tonAmount}
                    />
                    <Typography
                      variant="caption"
                      color="#728A96"
                      sx={{ mt: 0.5, display: "block" }}>
                      Amount of TON to add to the liquidity pool
                    </Typography>
                  </Box>

                  {!useDeepLink && (
                    <Box mb={3}>
                      <AppNumberInput
                        label="Token Amount"
                        onChange={(value: number) => setTokenAmount(value)}
                        value={tokenAmount}
                      />
                      <Typography
                        variant="caption"
                        color="#728A96"
                        sx={{ mt: 0.5, display: "block" }}>
                        Amount of tokens to add to the liquidity pool. This is required for creating
                        a new pool. If the pool already exists, you can leave this empty and the
                        system will calculate the token amount based on the current price.
                      </Typography>
                    </Box>
                  )}

                  <Box mb={3}>
                    <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
                      <input
                        type="checkbox"
                        checked={useDeepLink}
                        onChange={(e) => setUseDeepLink(e.target.checked)}
                        style={{ marginRight: 8 }}
                      />
                      <Typography variant="body2">
                        Use STON.fi web interface (recommended)
                      </Typography>
                    </Box>
                    <Typography variant="caption" color="#728A96">
                      {useDeepLink
                        ? "Redirects to STON.fi where you can complete the transaction safely"
                        : "Directly interacts with STON.fi smart contracts (advanced)"}
                    </Typography>
                  </Box>

                  <Box sx={{ display: "flex", justifyContent: "center", mt: 4 }}>
                    {!walletAddress ? (
                      <AppButton
                        height={50}
                        width={200}
                        fontWeight={700}
                        onClick={() => {
                          const container = document.getElementById("ton-connect-button");
                          const btn = container?.querySelector("button");
                          if (btn) btn.click();
                        }}
                        background="#0098EA">
                        Connect Wallet
                      </AppButton>
                    ) : (
                      <AppButton
                        disabled={!tokenAddress || !tonAmount || tonAmount <= 0}
                        onClick={handleCreatePool}
                        height={50}
                        width={200}
                        loading={isLoading}>
                        {useDeepLink ? "Open STON.fi" : "Create Pool"}
                      </AppButton>
                    )}
                  </Box>
                </Box>
              </SubHeadingWrapper>
              <Box sx={{ flex: 4 }}>
                <Description />
              </Box>
            </FormWrapper>
          </Box>
        </Fade>
      </ScreenContent>
    </Screen>
  );
}

export { LiquidityPage };

function Description() {
  return (
    <StyledDescription sx={{ padding: 3 }}>
      <Typography
        variant="h5"
        mb={3}
        sx={{
          color: "#161C28",
          fontSize: 20,
          fontWeight: 800,
        }}>
        About Liquidity Pools
      </Typography>
      <Typography
        sx={{
          fontWeight: 400,
          color: "#728A96",
          "& a": {
            textDecoration: "none",
            fontWeight: 500,
          },
        }}>
        A liquidity pool is a smart contract that holds reserves of two tokens, enabling trading
        between them. By creating a pool with your token and TON, you enable others to swap between
        them.
        <br />
        <br />
        <strong>How it works:</strong>
        <br />
        1. Enter your token's Jetton Master contract address
        <br />
        2. Specify the amount of TON you want to add
        <br />
        3. The system will create a new pool (if it doesn't exist) or add liquidity to an existing
        pool
        <br />
        4. You'll receive LP (Liquidity Provider) tokens representing your share of the pool
        <br />
        <br />
        <strong>Important Notes:</strong>
        <br />
        • Ensure you have enough TON for both the liquidity amount and transaction fees (~0.1-0.2
        TON)
        <br />
        • You'll need to approve the token spending if this is your first time
        <br />
        • The initial price is determined by the ratio of TON to tokens you provide
        <br />• This integration uses{" "}
        <Link target="_blank" href="https://app.ston.fi">
          STON.fi
        </Link>
        , a leading DEX on TON
        <br />
        <br />
        <strong>Recommended Method:</strong>
        <br />
        Using the STON.fi web interface (default) is recommended as it provides:
        <br />
        • Better user experience and safety checks
        <br />
        • Real-time price information
        <br />
        • Slippage protection
        <br />• Transaction preview before confirmation
      </Typography>
    </StyledDescription>
  );
}
