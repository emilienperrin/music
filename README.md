# music
user guide:
    server side:
        1. uvicorn main:app --host 0.0.0.0 --port 8000
        2. do this in the terminal to get the IP address:
           1. echo $(ipconfig getifaddr en0 || ipconfig getifaddr en1)
    client side:
        3. open http://<ipServer>:8000 in a web browser

conda env export --from-history > environment.yml