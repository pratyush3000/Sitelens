export async function checkBrandVisibility(prompt, model, allNames, retryCount = 0, maxRetries = 2) {
  const geminiKey = process.env.GEMINI_API_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY;

  // Pinned primary model: ensures consistent results day-to-day
  // Falls back to auto-router if this model becomes unavailable or fails
  const PINNED_FREE_MODEL = "liquid/lfm-2.5-1.2b-instruct:free";
  const OPENROUTER_AUTO_ROUTER = "openrouter/free";

  let aiResponse = "";
  let rawResponse = "";
  let modelUsed = model;
  let modelSource = "pinned";  // Track: "pinned" or "auto-router" (default pinned)

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

    console.log("🔄 [OPENROUTER] Calling free model (pinned with auto-router fallback)...");
    console.log(`📋 [OPENROUTER] API Key configured: ${openrouterKey ? "✅ YES (length: " + openrouterKey.length + ")" : "❌ NO"}`);
    console.log(`📋 [OPENROUTER] Primary model (pinned): ${PINNED_FREE_MODEL}`);
    console.log(`📋 [OPENROUTER] Fallback (auto-router): ${OPENROUTER_AUTO_ROUTER}`);
    console.log(`📋 [OPENROUTER] Prompt length: ${prompt.length} chars`);
    if (retryCount > 0) {
      console.log(`📋 [OPENROUTER] Retry attempt: ${retryCount + 1}/${maxRetries + 1}`);
    }

    // Determine which model to use based on retry count
    // Retry 0: try pinned model
    // Retry 1+: use auto-router fallback
    const useAutoRouter = retryCount > 0;
    const modelToUse = useAutoRouter ? OPENROUTER_AUTO_ROUTER : PINNED_FREE_MODEL;
    modelSource = useAutoRouter ? "auto-router" : "pinned";

    if (useAutoRouter) {
      console.log(`⚠️  [OPENROUTER] Pinned model failed, falling back to auto-router...`);
    }

    const requestBody = {
      model: modelToUse,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1024,  // ✅ Ensure reasoning models have budget for answer after thinking
      reasoning: { effort: "low" }  // ✅ Cap reasoning budget so tokens left for actual answer
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

      // Fallback to auto-router if pinned model fails (non-200, 404, 429, 5xx, etc.)
      if (!useAutoRouter && retryCount < maxRetries) {
        const reason = openrouterRes.status === 429
          ? "rate limited"
          : openrouterRes.status === 404
          ? "model unavailable"
          : `HTTP ${openrouterRes.status}`;

        console.warn(`⚠️  [OPENROUTER] Pinned model failed (${reason}). Falling back to auto-router...`);

        // If 429, wait before retrying
        if (openrouterRes.status === 429) {
          const retryAfter = openrouterRes.headers.get('Retry-After') || 25;
          console.warn(`⏳ [OPENROUTER] Waiting ${retryAfter}s before fallback retry...`);
          await new Promise(resolve => setTimeout(resolve, Math.min(retryAfter * 1000, 30000)));
        }

        console.log(`🔄 [OPENROUTER] Retrying with auto-router (attempt ${retryCount + 2}/${maxRetries + 1})...`);

        // Recursive call with incremented retryCount to use auto-router fallback
        return checkBrandVisibility(prompt, model, allNames, retryCount + 1, maxRetries);
      }

      // Final failure: both pinned model and auto-router have failed
      throw new Error(`OpenRouter API error (${openrouterRes.status}): ${errText.substring(0, 200)}`);
    }

    let openrouterData;
    try {
      openrouterData = await openrouterRes.json();
    } catch (parseErr) {
      console.error(`❌ [OPENROUTER] JSON parse error:`, parseErr.message);
      throw new Error(`OpenRouter response is not valid JSON`);
    }

    // Log which model OpenRouter's auto-router selected
    const selectedModel = openrouterData?.model || "unknown";
    console.log(`📦 [OPENROUTER] Auto-router selected: ${selectedModel}`);
    console.log(`📦 [OPENROUTER] Response keys:`, Object.keys(openrouterData));

    const message = openrouterData?.choices?.[0]?.message;
    aiResponse = message?.content || "";

    // Fallback: if content is empty, check if model returned reasoning instead
    // (happens with reasoning models like Nemotron when thinking budget exceeds answer budget)
    if (!aiResponse) {
      const reasoning = message?.reasoning || message?.reasoning_content || "";

      // If we have reasoning content, use it
      if (reasoning) {
        console.warn(`⚠️  [OPENROUTER] Response had only reasoning, no final answer. Using reasoning as fallback.`);
        console.warn(`   This indicates token budget was exhausted before model could write its answer.`);
        console.warn(`   Consider increasing max_tokens further or disabling reasoning for this model.`);
        aiResponse = reasoning;
      }
      // If pinned model returned completely empty, fall back to auto-router
      else if (!useAutoRouter && retryCount < maxRetries) {
        console.error("❌ [OPENROUTER] Pinned model returned empty response (no content or reasoning)");
        console.warn(`⚠️  [OPENROUTER] Falling back to auto-router due to empty response...`);
        console.log(`🔄 [OPENROUTER] Retrying with auto-router (attempt ${retryCount + 2}/${maxRetries + 1})...`);

        // Recursive call with incremented retryCount to use auto-router fallback
        return checkBrandVisibility(prompt, model, allNames, retryCount + 1, maxRetries);
      }
      // Final failure: empty response on both pinned and auto-router
      else {
        console.error("❌ [OPENROUTER] Response missing content/reasoning on both pinned and auto-router models");
        console.error(`   Full response: ${JSON.stringify(openrouterData).substring(0, 300)}`);
        throw new Error("OpenRouter returned empty response (no content or reasoning)");
      }
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
    model: modelUsed,       // Use the tracked modelUsed
    modelSource: modelSource  // ✅ Track: "pinned" or "auto-router" for consistency tracking
  };

  console.log(`✅ [${modelUsed.toUpperCase()}] Check complete: ${result.status} ${result.rank ? `#${result.rank}` : ""} (source: ${modelSource})`);
  return result;
}
