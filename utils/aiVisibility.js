export async function checkBrandVisibility(prompt, model, allNames, retryCount = 0, maxRetries = 1) {
  const geminiKey = process.env.GEMINI_API_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY;

  // Primary model: Deepseek (free, reliable)
  // Fallback: Mistral (if Deepseek is unavailable, rate-limited, or errors)
  const LLAMA_MODELS = [
    "deepseek/deepseek-chat-v3:free",     // Primary
    "mistralai/mistral-7b-instruct:free"  // Fallback
  ];

  let aiResponse = "";
  let rawResponse = "";
  let modelUsed = model;

  if (model === "gemini") {
    if (!geminiKey) throw new Error("Gemini API key not configured");

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      throw new Error(`Gemini API error: ${errText}`);
    }

    const geminiData = await geminiRes.json();
    aiResponse = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    rawResponse = JSON.stringify(geminiData);
  } else if (model === "llama") {
    if (!openrouterKey) throw new Error("OpenRouter API key not configured");

    console.log("🔄 [OPENROUTER] Preparing alternative model API call...");
    console.log(`📋 [OPENROUTER] API Key configured: ${openrouterKey ? "✅ YES (length: " + openrouterKey.length + ")" : "❌ NO"}`);
    console.log(`📋 [OPENROUTER] Primary model: ${LLAMA_MODELS[0]}`);
    console.log(`📋 [OPENROUTER] Fallback model: ${LLAMA_MODELS[1]}`);
    console.log(`📋 [OPENROUTER] Prompt length: ${prompt.length} chars`);
    console.log(`📋 [OPENROUTER] Attempt: ${retryCount + 1}/${maxRetries + 1}`);

    // Try primary model, fall back if rate limited
    const modelToUse = retryCount === 0 ? LLAMA_MODELS[0] : LLAMA_MODELS[1];
    console.log(`🎯 [OPENROUTER] Using model: ${modelToUse}`);

    const requestBody = {
      model: modelToUse,
      messages: [{ role: "user", content: prompt }]
    };

    console.log(`🚀 [OPENROUTER] Sending request to https://openrouter.ai/api/v1/chat/completions`);
    console.log(`🔐 [OPENROUTER] Auth header: Bearer ${openrouterKey.substring(0, 10)}...${openrouterKey.substring(openrouterKey.length - 5)}`);

    let openrouterRes;
    try {
      openrouterRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${openrouterKey}`
        },
        body: JSON.stringify(requestBody)
      });
      console.log(`📥 [OPENROUTER] Response status: ${openrouterRes.status} ${openrouterRes.statusText}`);
    } catch (fetchErr) {
      console.error(`❌ [OPENROUTER] Network/Fetch error:`, fetchErr.message);
      throw new Error(`OpenRouter fetch failed: ${fetchErr.message}`);
    }

    if (!openrouterRes.ok) {
      let errText = "";
      try {
        errText = await openrouterRes.text();
      } catch (e) {
        errText = "(could not read error body)";
      }
      console.error(`❌ [OPENROUTER] HTTP ${openrouterRes.status}:`);
      console.error(`   Response: ${errText.substring(0, 300)}`);

      // Fallback to secondary model on ANY error (404, 429, 500, etc.)
      if (retryCount < maxRetries) {
        const currentModel = LLAMA_MODELS[retryCount];
        const nextModel = LLAMA_MODELS[retryCount + 1];

        if (nextModel) {
          // Log the reason for fallback
          let reason = "";
          switch (openrouterRes.status) {
            case 404:
              reason = "Model unavailable/deprecated";
              break;
            case 429:
              reason = "Rate limited";
              const retryAfter = openrouterRes.headers.get('Retry-After') || 25;
              console.warn(`⏳ [OPENROUTER] Waiting ${retryAfter}s before fallback...`);
              await new Promise(resolve => setTimeout(resolve, Math.min(retryAfter * 1000, 30000)));
              break;
            case 500:
            case 502:
            case 503:
              reason = "Server error";
              break;
            default:
              reason = `HTTP ${openrouterRes.status}`;
          }

          console.warn(`⚠️  [OPENROUTER] Falling back from "${currentModel}" to "${nextModel}" (${reason})`);
          console.log(`🔄 [OPENROUTER] Attempting fallback model (attempt ${retryCount + 2}/${maxRetries + 1})...`);

          // Recursive call with incremented retryCount to use next model
          return checkBrandVisibility(prompt, model, allNames, retryCount + 1, maxRetries);
        }
      }

      // No more fallback models available
      throw new Error(`OpenRouter API error (${openrouterRes.status}): ${errText.substring(0, 200)}`);
    }

    let openrouterData;
    try {
      openrouterData = await openrouterRes.json();
    } catch (parseErr) {
      console.error(`❌ [OPENROUTER] JSON parse error:`, parseErr.message);
      throw new Error(`OpenRouter response is not valid JSON`);
    }

    console.log(`📦 [OPENROUTER] Response keys:`, Object.keys(openrouterData));
    aiResponse = openrouterData?.choices?.[0]?.message?.content || "";

    if (!aiResponse) {
      console.error("❌ [OPENROUTER] Response missing content at choices[0].message.content");
      console.error(`   Full response: ${JSON.stringify(openrouterData).substring(0, 300)}`);
      throw new Error("OpenRouter returned empty response");
    }

    rawResponse = JSON.stringify(openrouterData);
    console.log(`✅ [OPENROUTER] Success! Content length: ${aiResponse.length} chars`);
  } else {
    throw new Error(`Unknown model: ${model}`);
  }

  // Parse response for rank detection with alias support
  const lines = aiResponse.split("\n").filter(l => l.trim() !== "");
  let rank = null;
  let totalRecommendations = 0;
  let mentionSnippet = "Not mentioned";
  let matchedAs = null;

  lines.forEach(line => {
    const numberMatch = line.match(/^(\d+)[.)]/);
    if (numberMatch) {
      totalRecommendations++;
      const position = parseInt(numberMatch[1]);
      for (const name of allNames) {
        if (line.toLowerCase().includes(name.toLowerCase())) {
          rank = position;
          mentionSnippet = line.trim();
          matchedAs = name;
          break;
        }
      }
    }
  });

  if (totalRecommendations === 0) totalRecommendations = 5;
  const isVisible = rank !== null;

  // CRITICAL: Ensure model is NEVER undefined
  if (!modelUsed || modelUsed === "undefined") {
    throw new Error(`Internal error: model name is undefined (${modelUsed})`);
  }

  const result = {
    status: isVisible ? "VISIBLE" : "HIDDEN",
    rank,
    totalRecommendations,
    mentionSnippet,
    matchedAs,
    rawResponse: aiResponse,
    model: modelUsed  // Use the tracked modelUsed, not the parameter
  };

  console.log(`✅ [${modelUsed.toUpperCase()}] Check complete: ${result.status} ${result.rank ? `#${result.rank}` : ""}`);
  return result;
}
