function login() {
  const username = document.getElementById("username").value;
  const password = document.getElementById("password").value;

  console.log("🔐 Login attempt started");
  console.log("➡️ Username:", username);

  fetch("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  })
    .then(res => {
      console.log("⬅️ Login API status:", res.status);
      return res.json();
    })
    .then(data => {
      console.log("📦 Login API response:", data);

      if (data.token) {
        console.log("✅ Login successful");
        console.log("👤 User ID:", data.user.id);
        console.log("👤 User Name:", data.user.name);

        localStorage.setItem("token", data.token);
        localStorage.setItem("userId", data.user.id);
        localStorage.setItem("userName", data.user.name);

        console.log("➡️ Redirecting to menu.html");
        window.location.href = "/menu.html";
      } else {
        console.warn("❌ Invalid login response");
        alert("Invalid login");
      }
    })
    .catch(err => {
      console.error("🔥 Login request failed:", err);
      alert("Server error during login");
    });
}
