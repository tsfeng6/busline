import https from "https";

https.get("https://1316463596-7xje7hhw9f.ap-hongkong.tencentscf.com/api/submissions/approved", (res) => {
  console.log("STATUS:", res.statusCode);
  res.on("data", d => console.log(d.toString()));
}).on("error", console.error);
