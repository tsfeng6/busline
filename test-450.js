import https from "https";

https.get("https://1316463596-7xje7hhw9f.ap-hongkong.tencentscf.com/api/submissions/approved", (res) => {
  console.log("STATUS:", res.statusCode);
  let data = "";
  res.on("data", d => data += d.toString());
  res.on("end", () => console.log("BODY:", data));
}).on("error", console.error);
