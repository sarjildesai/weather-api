
pipeline {
    agent any

    options {
        timestamps()
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '20'))
    }

    environment {
        DOCKERHUB_CREDENTIALS = credentials('dockerhub-creds')
        IMAGE_NAME             = 'YOUR_DOCKERHUB_USERNAME/weather-api'
        SHORT_SHA               = "${GIT_COMMIT.take(7)}"
    }

    stages {

        stage('Determine Environment') {
            steps {
                script {
                    env.DEPLOY_ENV = (env.BRANCH_NAME == 'main')     ? 'prod' :
                                      (env.BRANCH_NAME == 'staging') ? 'staging' :
                                      (env.BRANCH_NAME == 'develop') ? 'dev' :
                                      'none'
                    echo "Branch: ${env.BRANCH_NAME}  ->  Environment: ${env.DEPLOY_ENV}"
                }
            }
        }

        stage('Install Dependencies') {
            steps {
                sh '''
                    python3 -m venv .venv
                    . .venv/bin/activate
                    pip install --no-cache-dir -r requirements.txt
                '''
            }
        }

        stage('Run Tests') {
            steps {
                sh '''
                    . .venv/bin/activate
                    python -m pytest test_app.py -v --junitxml=test-results.xml
                '''
            }
            post {
                always {
                    junit 'test-results.xml'
                }
            }
        }

        stage('Build Docker Image') {
            when { expression { env.DEPLOY_ENV != 'none' } }
            steps {
                sh "docker build -t ${IMAGE_NAME}:${DEPLOY_ENV}-${SHORT_SHA} -t ${IMAGE_NAME}:${DEPLOY_ENV}-latest ."
            }
        }

        stage('Approval for Production') {
            when { expression { env.DEPLOY_ENV == 'prod' } }
            steps {
                timeout(time: 30, unit: 'MINUTES') {
                    input message: "Push ${IMAGE_NAME}:prod-${SHORT_SHA} to Docker Hub and deploy to PRODUCTION?", ok: 'Deploy'
                }
            }
        }

        stage('Push Image to Docker Hub') {
            when { expression { env.DEPLOY_ENV != 'none' } }
            steps {
                sh '''
                    echo "$DOCKERHUB_CREDENTIALS_PSW" | docker login -u "$DOCKERHUB_CREDENTIALS_USR" --password-stdin
                    docker push ${IMAGE_NAME}:${DEPLOY_ENV}-${SHORT_SHA}
                    docker push ${IMAGE_NAME}:${DEPLOY_ENV}-latest
                    docker logout
                '''
            }
        }
    }

    post {
        success {
            echo "Pipeline finished OK for branch ${env.BRANCH_NAME} (env: ${env.DEPLOY_ENV})."
        }
        failure {
            echo "Pipeline failed on branch ${env.BRANCH_NAME}."
        }
        always {
            sh 'docker image prune -f || true'
        }
    }
}